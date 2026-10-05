import { randomUUID } from "node:crypto";
import type { Role } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

/**
 * The default approval chain (ADR-0009), per role, on a workspace provisioned
 * with the catalog defaults: work orders go to the Administrateur of the
 * branch, money entries to Finance up to 1 000 000 XAF, anything above it to
 * Direction, and Direction may decide anything (owner decision 2026-10-05).
 */
describe("default approval chain", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let assetId: string;
  const tokens = {} as Record<
    "director" | "finance" | "adminDla" | "adminBfs" | "cashier" | "technician" | "driver",
    string
  >;

  /** The recording band every maker role ships with (provisioning/packs/core.ts). */
  const RECORDING_BAND = 100_000;
  /** Finance's decision band: above it, Direction decides. */
  const FINANCE_BAND = 1_000_000;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const [bfs] = await db
      .insert(branches)
      .values({ workspaceId, code: "BFS", name: "Bafoussam" })
      .returning();
    if (!bfs) throw new Error("branch insert returned no row");

    const member = async (role: Role, branchIds?: string[]) => {
      const seededMember = await seedMember(db, {
        workspaceId,
        role,
        ...(branchIds === undefined ? { allBranches: true } : { branchIds }),
      });
      return (await createSession(db, { workspaceId, principalId: seededMember.principal.id })).token;
    };
    tokens.director = await member("DIRECTOR");
    tokens.finance = await member("FINANCE");
    tokens.adminDla = await member("ADMIN", [seeded.branch.id]);
    tokens.adminBfs = await member("ADMIN", [bfs.id]);
    tokens.cashier = await member("CASHIER");
    tokens.technician = await member("TECHNICIAN");
    tokens.driver = await member("DRIVER");

    assetId = randomUUID();
    expect(
      (
        await post(tokens.director, "register-asset", {
          assetId,
          assetCode: `CHAIN-${assetId.slice(0, 8)}`,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        })
      ).statusCode,
    ).toBe(200);
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

  /** A driver's expense that waits for review. */
  async function pendingExpense(amountMinor: number): Promise<string> {
    const entryId = randomUUID();
    const response = await post(tokens.driver, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
      amountMinor,
      paymentMethod: "MOMO",
      paymentReference: `MOMO-${randomUUID()}`,
      postings: [{ assetId, amountMinor }],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordStatus: "SUBMITTED" });
    return entryId;
  }

  async function decideEntry(
    token: string,
    name: "approve-entry" | "reject-entry",
    entryId: string,
  ) {
    const response = await post(
      token,
      name,
      name === "approve-entry" ? { entryId } : { entryId, reason: "Pas de reçu" },
      { expectedVersion: 1 },
    );
    return { status: response.statusCode, code: response.json()?.error?.code as string | undefined };
  }

  describe("money entries", () => {
    let belowBandEntryIds: string[];
    let financeBandEntryIds: string[];
    let aboveBandEntryIds: string[];

    beforeAll(async () => {
      // A tenant may hold every driver expense for review: the driver's band is
      // tenant data. The other roles keep the recording band.
      const driverRules = await db
        .delete(approvalRules)
        .where(
          and(
            eq(approvalRules.workspaceId, workspaceId),
            eq(approvalRules.commandType, "record-expense"),
            eq(approvalRules.requiredRole, "DRIVER"),
          ),
        )
        .returning();
      belowBandEntryIds = await Promise.all([1, 2].map(() => pendingExpense(60_000)));
      await db.insert(approvalRules).values(driverRules);
      financeBandEntryIds = await Promise.all([1, 2, 3, 4].map(() => pendingExpense(450_000)));
      aboveBandEntryIds = await Promise.all([1, 2, 3, 4].map(() => pendingExpense(FINANCE_BAND + 500_000)));
    });

    it("tells each decider, on the queue and the entry, which entries Direction decides", async () => {
      const read = async (token: string, url: string) =>
        (await ctx.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } })).json();
      for (const [token, aboveBand] of [
        [tokens.finance, true],
        [tokens.director, false],
      ] as const) {
        const queue = (await read(token, "/v1/finance/approvals?limit=100")) as {
          entries: Array<{ id: string; directionDecides: boolean }>;
        };
        const flag = (id: string) => queue.entries.find((entry) => entry.id === id)?.directionDecides;
        expect([...belowBandEntryIds, ...financeBandEntryIds].map(flag)).toEqual([false, false, false, false, false, false]);
        expect(aboveBandEntryIds.map(flag)).toEqual([aboveBand, aboveBand, aboveBand, aboveBand]);

        const detail = await read(token, `/v1/finance/entries/${aboveBandEntryIds[0]}`);
        expect(detail).toMatchObject({ directionDecides: aboveBand });

        // The vehicle's to-do flags the same entries (#393).
        const attention = (await read(token, `/v1/assets/${assetId}/attention`)) as {
          items: Array<{ code: string; subject: { id: string }; params: { directionDecides?: boolean } }>;
        };
        const review = (id: string) =>
          attention.items.find((item) => item.code === "ENTRY_AWAITING_REVIEW" && item.subject.id === id)
            ?.params.directionDecides;
        expect([...belowBandEntryIds, ...financeBandEntryIds].map(review)).toEqual([false, false, false, false, false, false]);
        expect(aboveBandEntryIds.map(review)).toEqual([aboveBand, aboveBand, aboveBand, aboveBand]);
      }
    });

    it("lets FINANCE approve and reject above the recording band, up to its own", async () => {
      expect(RECORDING_BAND).toBeLessThan(450_000);
      expect(await decideEntry(tokens.finance, "approve-entry", financeBandEntryIds[0]!)).toEqual({
        status: 200,
        code: undefined,
      });
      expect(await decideEntry(tokens.finance, "reject-entry", financeBandEntryIds[1]!)).toEqual({
        status: 200,
        code: undefined,
      });
      expect((await decideEntry(tokens.finance, "approve-entry", belowBandEntryIds[0]!)).status).toBe(200);
    });

    it("sends an entry above Finance's band to Direction: FINANCE is refused", async () => {
      for (const name of ["approve-entry", "reject-entry"] as const) {
        expect(await decideEntry(tokens.finance, name, aboveBandEntryIds[0]!)).toEqual({
          status: 403,
          code: "APPROVAL_REQUIRED",
        });
      }
    });

    it("lets DIRECTOR decide at any amount", async () => {
      expect((await decideEntry(tokens.director, "approve-entry", aboveBandEntryIds[0]!)).status).toBe(200);
      expect((await decideEntry(tokens.director, "reject-entry", aboveBandEntryIds[1]!)).status).toBe(200);
      expect((await decideEntry(tokens.director, "approve-entry", financeBandEntryIds[2]!)).status).toBe(200);
    });

    it("refuses every other role at any amount", async () => {
      for (const token of [tokens.adminDla, tokens.cashier, tokens.technician, tokens.driver]) {
        for (const entryId of [belowBandEntryIds[1]!, financeBandEntryIds[3]!, aboveBandEntryIds[2]!]) {
          expect(await decideEntry(token, "approve-entry", entryId)).toEqual({
            status: 403,
            code: "ROLE_FORBIDDEN",
          });
        }
      }
    });

    it("lets Direction move Finance's band, for approving and rejecting alike", async () => {
      expect(
        (
          await post(tokens.director, "update-approval-threshold", {
            commandType: "approve-entry",
            amountMaxMinor: FINANCE_BAND * 2,
          })
        ).statusCode,
      ).toBe(200);
      expect(await decideEntry(tokens.finance, "reject-entry", aboveBandEntryIds[3]!)).toEqual({
        status: 200,
        code: undefined,
      });
      expect(
        await decideEntry(tokens.finance, "approve-entry", await pendingExpense(FINANCE_BAND * 2 + 1)),
      ).toEqual({ status: 403, code: "APPROVAL_REQUIRED" });
      // Recording bands no longer move it.
      expect(
        (
          await post(tokens.director, "update-approval-threshold", {
            commandType: "record-expense",
            amountMaxMinor: 50_000,
          })
        ).statusCode,
      ).toBe(200);
      const [band] = await db
        .select({ max: approvalRules.amountMaxMinor })
        .from(approvalRules)
        .where(
          and(
            eq(approvalRules.workspaceId, workspaceId),
            eq(approvalRules.commandType, "reject-entry"),
            eq(approvalRules.requiredRole, "FINANCE"),
          ),
        );
      expect(band?.max).toBe(BigInt(FINANCE_BAND * 2));
    });
  });

  describe("work orders", () => {
    beforeAll(async () => {
      // Direction sets the first work-order bands: above them the workshop waits.
      for (const commandType of ["create-work-order", "complete-work-order"]) {
        expect(
          (
            await post(tokens.director, "update-approval-threshold", {
              commandType,
              amountMaxMinor: 50_000,
            })
          ).statusCode,
        ).toBe(200);
      }
    });

    async function submittedWorkOrder(): Promise<string> {
      const workOrderId = randomUUID();
      const response = await post(tokens.technician, "create-work-order", {
        workOrderId,
        assetId,
        description: "Embrayage",
        expectedCostMinor: 400_000,
      });
      expect(response.json()).toMatchObject({ recordStatus: "SUBMITTED" });
      return workOrderId;
    }

    async function completionSubmitted(): Promise<string> {
      const workOrderId = await submittedWorkOrder();
      expect(
        (await post(tokens.adminDla, "approve-work-order", { workOrderId }, { expectedVersion: 1 })).statusCode,
      ).toBe(200);
      const completed = await post(
        tokens.technician,
        "complete-work-order",
        { workOrderId, actualCostMinor: 420_000, summary: "Embrayage remplacé" },
        { expectedVersion: 2 },
      );
      expect(completed.json()).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
      return workOrderId;
    }

    it("goes to the Administrateur of the work order's branch, and to Direction", async () => {
      for (const token of [tokens.adminDla, tokens.director]) {
        const workOrderId = await submittedWorkOrder();
        const response = await post(token, "approve-work-order", { workOrderId }, { expectedVersion: 1 });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ recordStatus: "APPROVED" });
      }
      for (const token of [tokens.adminDla, tokens.director]) {
        const workOrderId = await completionSubmitted();
        const response = await post(
          token,
          "approve-work-order-closure",
          { workOrderId },
          { expectedVersion: 3 },
        );
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ recordStatus: "COMPLETED" });
      }
    });

    it("refuses an Administrateur of another branch", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(tokens.adminBfs, "approve-work-order", { workOrderId }, { expectedVersion: 1 });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });

    it("refuses Finance and the field roles", async () => {
      const workOrderId = await submittedWorkOrder();
      const closingId = await completionSubmitted();
      for (const token of [tokens.finance, tokens.cashier, tokens.technician, tokens.driver]) {
        for (const [name, id, expectedVersion] of [
          ["approve-work-order", workOrderId, 1],
          ["reject-work-order", workOrderId, 1],
          ["approve-work-order-closure", closingId, 3],
          ["reject-work-order-completion", closingId, 3],
        ] as const) {
          const payload = name.startsWith("reject-") ? { workOrderId: id, reason: "Non" } : { workOrderId: id };
          const response = await post(token, name, payload, { expectedVersion });
          expect(response.statusCode, `${name}`).toBe(403);
          expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
        }
      }
    });
  });
});
