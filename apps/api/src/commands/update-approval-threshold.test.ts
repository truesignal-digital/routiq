import { updateApprovalThresholdPayload } from "@routiq/contracts";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, financialEntries } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("update-approval-threshold contract", () => {
  function validatePayload(payload: unknown) {
    return updateApprovalThresholdPayload.parse(payload);
  }

  it("round-trips a valid payload", () => {
    const payload = {
      commandType: "record-expense" as const,
      amountMaxMinor: 200_000,
    };

    expect(validatePayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it("allows zero at the lower boundary and rejects values below it", () => {
    expect(
      validatePayload({
        commandType: "record-expense",
        amountMaxMinor: 0,
      }),
    ).toEqual({
      commandType: "record-expense",
      amountMaxMinor: 0,
    });
    expect(
      updateApprovalThresholdPayload.safeParse({
        commandType: "record-expense",
        amountMaxMinor: -1,
      }).success,
    ).toBe(false);
  });
});

describe("update-approval-threshold.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let branchId: string;
  let adminToken: string;
  let opsManagerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(db, {
        principalId: admin.principal.id,
        workspaceId,
      })
    ).token;

    const opsManager = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    opsManagerToken = (
      await createSession(db, {
        principalId: opsManager.principal.id,
        workspaceId,
      })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("returns 403 when a non-ADMIN tries to update a threshold", async () => {
    const response = await postCommand(
      opsManagerToken,
      "update-approval-threshold",
      {
        commandType: "record-expense",
        amountMaxMinor: 200_000,
      },
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "ROLE_FORBIDDEN",
        metadata: { command: "update-approval-threshold.v1" },
      },
    });
  });

  it("allows ADMIN to update threshold with status 200", async () => {
    const response = await postCommand(
      adminToken,
      "update-approval-threshold",
      {
        commandType: "record-expense",
        amountMaxMinor: 250_000,
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("commandId");
    expect(response.json()).toHaveProperty("warnings");
  });

  it("threshold change affects entry posting behavior", async () => {
    // Set threshold to 100_000
    await postCommand(adminToken, "update-approval-threshold", {
      commandType: "record-expense",
      amountMaxMinor: 100_000,
    });

    // Record 150_000 expense → should be SUBMITTED (above 100_000 threshold)
    const entryId1 = randomUUID();
    let response = await postCommand(opsManagerToken, "record-expense", {
      entryId: entryId1,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 150_000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 150_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordStatus).toBe("SUBMITTED");

    let [entry1] = await db
      .select({ status: financialEntries.status })
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId1));
    expect(entry1?.status).toBe("SUBMITTED");

    // Raise threshold to 200_000
    await postCommand(adminToken, "update-approval-threshold", {
      commandType: "record-expense",
      amountMaxMinor: 200_000,
    });

    // Record 150_000 expense → should be POSTED (now below 200_000 threshold)
    const entryId2 = randomUUID();
    response = await postCommand(opsManagerToken, "record-expense", {
      entryId: entryId2,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 150_000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 150_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordStatus).toBe("POSTED");

    let [entry2] = await db
      .select({ status: financialEntries.status })
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId2));
    expect(entry2?.status).toBe("POSTED");

    // Lower threshold back to 100_000
    await postCommand(adminToken, "update-approval-threshold", {
      commandType: "record-expense",
      amountMaxMinor: 100_000,
    });

    // Record 150_000 expense → should be SUBMITTED (back above 100_000 threshold)
    const entryId3 = randomUUID();
    response = await postCommand(opsManagerToken, "record-expense", {
      entryId: entryId3,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 150_000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 150_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordStatus).toBe("SUBMITTED");

    let [entry3] = await db
      .select({ status: financialEntries.status })
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId3));
    expect(entry3?.status).toBe("SUBMITTED");
  });

  function postCommand(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    commandId = randomUUID(),
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId,
          idempotencyKey: `${name}-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }
});

/**
 * #47 spec finding: work-order thresholds must be reachable through the tenant
 * configuration path, not only by inserting rules. Their catalog defaults are
 * unbounded, so the first threshold turns them into a band — ADMIN keeps an
 * unbounded rule beside its band, the way record-expense ships.
 */
describe("update-approval-threshold.v1 for the work-order pair", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let managerToken: string;
  let mechanicToken: string;
  let assetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const token = async (role: "ADMIN" | "OPS_MANAGER" | "MAINTENANCE") => {
      const member = await seedMember(db, { workspaceId, role, allBranches: true });
      return (await createSession(db, { workspaceId, principalId: member.principal.id }))
        .token;
    };
    adminToken = await token("ADMIN");
    managerToken = await token("OPS_MANAGER");
    mechanicToken = await token("MAINTENANCE");
    assetId = await seedAsset(ctx.app, adminToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function post(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
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

  async function createStatus(token: string, expectedCostMinor: number): Promise<string> {
    const response = await post(token, "create-work-order", {
      workOrderId: randomUUID(),
      assetId,
      description: "Seuil",
      expectedCostMinor,
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { recordStatus: string }).recordStatus;
  }

  function rulesFor(commandType: string) {
    return db
      .select()
      .from(approvalRules)
      .where(
        and(eq(approvalRules.workspaceId, workspaceId), eq(approvalRules.commandType, commandType)),
      );
  }

  it("never holds a work order until a threshold is configured", async () => {
    expect(await createStatus(managerToken, 5_000_000)).toBe("APPROVED");
  });

  it("turns the unbounded defaults into a band on first configuration", async () => {
    const response = await post(adminToken, "update-approval-threshold", {
      commandType: "create-work-order",
      amountMaxMinor: 200_000,
    });
    expect(response.statusCode).toBe(200);

    const rules = (await rulesFor("create-work-order"))
      .map((rule) => `${rule.requiredRole}:${rule.amountMaxMinor ?? "∞"}`)
      .sort();
    expect(rules).toEqual([
      "ADMIN:200000",
      "ADMIN:∞",
      "MAINTENANCE:200000",
      "OPS_MANAGER:200000",
    ]);

    expect(await createStatus(managerToken, 150_000)).toBe("APPROVED");
    expect(await createStatus(managerToken, 500_000)).toBe("SUBMITTED");
    expect(await createStatus(mechanicToken, 500_000)).toBe("SUBMITTED");
    // An admin is not queued behind an approver at either end of the band.
    expect(await createStatus(adminToken, 150_000)).toBe("APPROVED");
    expect(await createStatus(adminToken, 500_000)).toBe("APPROVED");
  });

  it("moves the band on the next configuration instead of adding another", async () => {
    const response = await post(adminToken, "update-approval-threshold", {
      commandType: "create-work-order",
      amountMaxMinor: 600_000,
    });
    expect(response.statusCode).toBe(200);
    expect(await rulesFor("create-work-order")).toHaveLength(4);
    expect(await createStatus(managerToken, 500_000)).toBe("APPROVED");
    expect(await createStatus(managerToken, 700_000)).toBe("SUBMITTED");
  });

  it("holds a completion above the configured band", async () => {
    expect(
      (
        await post(adminToken, "update-approval-threshold", {
          commandType: "complete-work-order",
          amountMaxMinor: 50_000,
        })
      ).statusCode,
    ).toBe(200);

    const workOrderId = randomUUID();
    await post(managerToken, "create-work-order", {
      workOrderId,
      assetId,
      description: "Achèvement au-dessus du seuil",
      expectedCostMinor: 10_000,
    });
    const completed = await post(
      managerToken,
      "complete-work-order",
      { workOrderId, actualCostMinor: 80_000 },
      { expectedVersion: 1 },
    );
    expect(completed.json()).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
  });

  /** Review P4: an order without an expected cost used to be read as 0 and slip under every band. */
  it("gives an order no way under the band by leaving its expected cost out", async () => {
    expect(
      (
        await post(adminToken, "update-approval-threshold", {
          commandType: "create-work-order",
          amountMaxMinor: 50_000,
        })
      ).statusCode,
    ).toBe(200);

    const omitted = await post(mechanicToken, "create-work-order", {
      workOrderId: randomUUID(),
      assetId,
      description: "Moteur",
    });
    expect(omitted.statusCode).toBe(400);
    expect(omitted.json()).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        metadata: { issues: [{ path: ["expectedCostMinor"] }] },
      },
    });
    expect(await createStatus(mechanicToken, 2_000_000)).toBe("SUBMITTED");
  });
});
