import { randomUUID } from "node:crypto";
import type { ApprovalThresholdsResponse, Role } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRuleChanges, approvalRules, auditEvents } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

/**
 * #354: Direction moves both bands of the money chain from Company settings,
 * through update-approval-threshold v2, and reads them back with the chain
 * each role now meets.
 */
describe("approval thresholds (#354)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let branchId: string;
  let assetId: string;
  const tokens = {} as Record<Role, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;
    for (const role of ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      const member = await seedMember(db, { workspaceId, role, allBranches: true });
      tokens[role] = (await createSession(db, { workspaceId, principalId: member.principal.id })).token;
    }
    assetId = await seedAsset(ctx.app, tokens.DIRECTOR);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function read(token: string) {
    return ctx.app.inject({
      method: "GET",
      url: "/v1/approval-thresholds",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function current(): Promise<ApprovalThresholdsResponse> {
    const response = await read(tokens.DIRECTOR);
    expect(response.statusCode).toBe(200);
    return response.json() as ApprovalThresholdsResponse;
  }

  function post(
    token: string,
    name: string,
    version: number,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...envelope,
        },
        payload,
      },
    });
  }

  async function setBands(recordingThresholdMinor: number, financeCeilingMinor: number) {
    const { version } = await current();
    return post(
      tokens.DIRECTOR,
      "update-approval-threshold",
      2,
      { recordingThresholdMinor, financeCeilingMinor },
      { expectedVersion: version },
    );
  }

  async function recordExpense(token: string, amountMinor: number): Promise<string> {
    const response = await post(token, "record-expense", 1, {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
      amountMinor,
      paymentMethod: "MOMO",
      paymentReference: `MOMO-${randomUUID()}`,
      postings: [{ assetId, amountMinor }],
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { recordStatus: string }).recordStatus;
  }

  async function changeRows() {
    return db
      .select()
      .from(approvalRuleChanges)
      .where(eq(approvalRuleChanges.workspaceId, workspaceId));
  }

  describe("GET /v1/approval-thresholds", () => {
    it("shows Direction the default bands and, per role, the chain its own entries meet", async () => {
      const body = await current();
      expect(body).toMatchObject({
        currency: "XAF",
        recordingThresholdMinor: 100_000,
        financeCeilingMinor: 1_000_000,
        overrides: [],
        lastChange: null,
      });
      expect(body.affectedRoles.sort()).toEqual(
        ["ADMIN", "CASHIER", "DRIVER", "FINANCE", "TECHNICIAN"].sort(),
      );
      const chainOf = (role: Role) =>
        body.roles.find((entry) => entry.role === role)?.chains.find(
          (chain) => chain.commandType === "record-expense",
        )?.steps;
      expect(chainOf("DRIVER")).toEqual([
        { upToMinor: 100_000, outcome: "POSTS_DIRECTLY" },
        { upToMinor: 1_000_000, outcome: "FINANCE_APPROVES" },
        { upToMinor: null, outcome: "DIRECTION_APPROVES" },
      ]);
      expect(chainOf("FINANCE")).toEqual([
        { upToMinor: 100_000, outcome: "POSTS_DIRECTLY" },
        { upToMinor: 1_000_000, outcome: "FINANCE_PEER_APPROVES" },
        { upToMinor: null, outcome: "DIRECTION_APPROVES" },
      ]);
      expect(chainOf("DIRECTOR")).toEqual([{ upToMinor: null, outcome: "POSTS_DIRECTLY" }]);
    });

    it("is Direction's alone: every other role is refused", async () => {
      for (const role of ["ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
        const response = await read(tokens[role]);
        expect(response.statusCode, role).toBe(403);
      }
    });
  });

  describe("update-approval-threshold v2", () => {
    it("refuses every role but Direction", async () => {
      const { version } = await current();
      for (const role of ["ADMIN", "FINANCE"] as const) {
        const response = await post(
          tokens[role],
          "update-approval-threshold",
          2,
          { recordingThresholdMinor: 150_000, financeCeilingMinor: 1_000_000 },
          { expectedVersion: version },
        );
        expect(response.statusCode, role).toBe(403);
        expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
      }
    });

    it("keeps the recording threshold below the Finance ceiling, with a stable code", async () => {
      for (const [recording, ceiling] of [
        [1_000_000, 1_000_000],
        [2_000_000, 1_000_000],
      ] as const) {
        const response = await setBands(recording, ceiling);
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({
          error: { code: "RECORDING_THRESHOLD_NOT_BELOW_CEILING" },
        });
      }
      expect(await current()).toMatchObject({
        recordingThresholdMinor: 100_000,
        financeCeilingMinor: 1_000_000,
      });
    });

    it("refuses a change made against bands that moved since they were read", async () => {
      const { version } = await current();
      const missing = await post(tokens.DIRECTOR, "update-approval-threshold", 2, {
        recordingThresholdMinor: 150_000,
        financeCeilingMinor: 1_000_000,
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({ error: { code: "EXPECTED_VERSION_REQUIRED" } });
      const stale = await post(
        tokens.DIRECTOR,
        "update-approval-threshold",
        2,
        { recordingThresholdMinor: 150_000, financeCeilingMinor: 1_000_000 },
        { expectedVersion: version - 1 },
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    });

    it("moves both bands at once: recording, and who decides", async () => {
      expect(await recordExpense(tokens.DRIVER, 150_000)).toBe("SUBMITTED");
      const before = await changeRows();

      const response = await setBands(200_000, 2_000_000);
      expect(response.statusCode).toBe(200);

      expect(await recordExpense(tokens.DRIVER, 150_000)).toBe("POSTED");
      expect(await recordExpense(tokens.ADMIN, 200_000)).toBe("POSTED");
      expect(await recordExpense(tokens.ADMIN, 200_001)).toBe("SUBMITTED");

      const body = await current();
      expect(body).toMatchObject({ recordingThresholdMinor: 200_000, financeCeilingMinor: 2_000_000 });
      expect(
        body.roles.find((entry) => entry.role === "CASHIER")?.chains[0]?.steps,
      ).toEqual([
        { upToMinor: 200_000, outcome: "POSTS_DIRECTLY" },
        { upToMinor: 2_000_000, outcome: "FINANCE_APPROVES" },
        { upToMinor: null, outcome: "DIRECTION_APPROVES" },
      ]);

      // One change, one notice for the members it moves, one audit event.
      const after = await changeRows();
      expect(after.length).toBe(before.length + 1);
      expect(body.lastChange).not.toBeNull();
      const commandId = (response.json() as { commandId: string }).commandId;
      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.commandId, commandId)));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: "approval-threshold.updated",
        beforeState: { recordingThresholdMinor: "100000", financeCeilingMinor: "1000000" },
        afterState: { recordingThresholdMinor: "200000", financeCeilingMinor: "2000000" },
      });

      const notice = await ctx.app.inject({
        method: "GET",
        url: "/v1/approval-chain",
        headers: { authorization: `Bearer ${tokens.FINANCE}` },
      });
      expect(notice.json()).toMatchObject({ notice: { changeId: after.at(-1)?.id } });
    });

    it("lets Finance decide up to the new ceiling, and only Direction above it", async () => {
      // A cashier's 1 500 000 entry: inside Finance's new band of 2 000 000.
      const entryId = randomUUID();
      const recorded = await post(tokens.CASHIER, "record-expense", 1, {
        entryId,
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
        amountMinor: 1_500_000,
        paymentMethod: "MOMO",
        paymentReference: `MOMO-${randomUUID()}`,
        postings: [{ assetId, amountMinor: 1_500_000 }],
      });
      expect(recorded.json()).toMatchObject({ recordStatus: "SUBMITTED" });
      const approved = await post(tokens.FINANCE, "approve-entry", 1, { entryId }, { expectedVersion: 1 });
      expect(approved.statusCode).toBe(200);
    });

    it("writes nothing when neither band moves", async () => {
      const before = await changeRows();
      const { version } = await current();
      const response = await setBands(200_000, 2_000_000);
      expect(response.statusCode).toBe(200);
      expect(await changeRows()).toHaveLength(before.length);
      expect((await current()).version).toBe(version);
    });

    it("leaves a branch's or a category's own rule alone, and lists it apart", async () => {
      await db.insert(approvalRules).values({
        workspaceId,
        commandType: "record-expense",
        categoryCode: "FUEL",
        branchId,
        amountMinMinor: null,
        amountMaxMinor: 50_000n,
        requiredRole: "DRIVER",
        createdByCommandId: null,
      });

      expect((await setBands(300_000, 3_000_000)).statusCode).toBe(200);

      const [override] = await db
        .select({ amountMaxMinor: approvalRules.amountMaxMinor })
        .from(approvalRules)
        .where(
          and(
            eq(approvalRules.workspaceId, workspaceId),
            eq(approvalRules.branchId, branchId),
            eq(approvalRules.categoryCode, "FUEL"),
          ),
        );
      expect(override?.amountMaxMinor).toBe(50_000n);
      expect((await current()).overrides).toEqual([
        {
          commandType: "record-expense",
          branchName: "Douala",
          categoryCode: "FUEL",
          amountMinMinor: null,
          amountMaxMinor: 50_000,
          requiredRole: "DRIVER",
        },
      ]);
    });
  });
});
