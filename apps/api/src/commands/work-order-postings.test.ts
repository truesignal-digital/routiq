import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  branches,
  financialEntries,
  financialPostings,
  workOrders,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * How labour and parts reach the chronologie of the repair that incurred them
 * (§4.2): a posting line carries the work order, exactly as it already carries
 * the activity. One dimension on the line, never a second entry — and since
 * #28, only on APPROVED work, inside the actor's branch scope (#47 finding 3),
 * and carried onto the reversal that corrects it (#47 finding 4).
 */
describe("work-order cost attribution", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let approverToken: string;
  let maintenanceToken: string;
  let doualaManagerToken: string;
  let assetId: string;
  let otherAssetId: string;
  let yaoundeAssetId: string;
  let workOrderId: string;
  let otherWorkspaceWorkOrderId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();

    const session = async (
      role: "ADMIN" | "FINANCE" | "TECHNICIAN" | "ADMIN",
      scope: { allBranches: true } | { branchIds: string[] },
    ) => {
      const member = await seedMember(db, { workspaceId, role, ...scope });
      return (
        await createSession(db, { workspaceId, principalId: member.principal.id })
      ).token;
    };
    adminToken = await session("ADMIN", { allBranches: true });
    approverToken = await session("FINANCE", { allBranches: true });
    maintenanceToken = await session("TECHNICIAN", { allBranches: true });
    doualaManagerToken = await session("ADMIN", {
      branchIds: [seeded.branch.id],
    });

    assetId = await seedAsset(ctx.app, adminToken);
    otherAssetId = await seedAsset(ctx.app, adminToken);
    yaoundeAssetId = await seedAsset(ctx.app, adminToken, { branchCode: "YDE" });
    expect(yaounde).toBeDefined();
    workOrderId = await openWorkOrder(adminToken, assetId);

    const otherSeeded = await seedWorkspace(db);
    const otherAdmin = await seedMember(db, {
      workspaceId: otherSeeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const otherToken = (
      await createSession(db, {
        workspaceId: otherSeeded.workspace.id,
        principalId: otherAdmin.principal.id,
      })
    ).token;
    otherWorkspaceWorkOrderId = await openWorkOrder(
      otherToken,
      await seedAsset(ctx.app, otherToken),
    );
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
        name,
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

  async function openWorkOrder(
    token: string,
    targetAssetId: string,
  ): Promise<string> {
    const id = randomUUID();
    const response = await post(token, "create-work-order", {
      workOrderId: id,
      assetId: targetAssetId,
      description: "Remplacement de la pompe à eau",
      expectedCostMinor: 60_000,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordStatus: "APPROVED" });
    return id;
  }

  function recordRepairExpense(
    postings: Array<Record<string, unknown>>,
    amountMinor: number,
    token = adminToken,
    command = "record-expense",
  ) {
    const entryId = randomUUID();
    return post(token, command, {
      entryId,
      branchCode: "DLA",
      categoryCode: command === "record-expense" ? "REPAIRS" : "FREIGHT_REVENUE",
      economicDate: "2026-08-12",
      amountMinor,
      paymentMethod: "CASH",
      postings,
    }).then((response) => ({ response, entryId }));
  }

  function postingsOf(entryId: string) {
    return db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
  }

  /**
   * A work order parked in a given state without walking every command there
   * — the writer's check is what is under test, not the state machine. The
   * row reuses a real creating receipt so the composite command FK holds.
   */
  async function workOrderIn(status: (typeof workOrders.$inferSelect)["status"]) {
    const [template] = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.workspaceId, workspaceId), eq(workOrders.id, workOrderId)));
    const id = randomUUID();
    await db.insert(workOrders).values({ ...template!, id, status });
    return id;
  }

  it("writes the work order through to the posting line", async () => {
    const { response, entryId } = await recordRepairExpense(
      [{ assetId, workOrderId, amountMinor: 58_000 }],
      58_000,
    );

    expect(response.statusCode).toBe(200);
    const postings = await postingsOf(entryId);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      workspaceId,
      assetId,
      workOrderId,
      amountMinor: 58_000n,
    });
  });

  it("leaves the dimension null when no work order is named", async () => {
    const entryId = randomUUID();
    expect(
      (
        await post(adminToken, "record-expense", {
          entryId,
          branchCode: "DLA",
          categoryCode: "FUEL",
          economicDate: "2026-08-12",
          amountMinor: 30_000,
          paymentMethod: "CASH",
          postings: [{ assetId, amountMinor: 30_000 }],
        })
      ).statusCode,
    ).toBe(200);

    expect((await postingsOf(entryId))[0]?.workOrderId).toBeNull();
  });

  it("refuses a work order from another workspace", async () => {
    const { response } = await recordRepairExpense(
      [{ assetId, workOrderId: otherWorkspaceWorkOrderId, amountMinor: 10_000 }],
      10_000,
    );

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "REFERENCE_NOT_FOUND",
        metadata: {
          referenceType: "workOrder",
          missing: [otherWorkspaceWorkOrderId],
        },
      },
    });
  });

  describe("costs attach only to APPROVED work (#28)", () => {
    for (const status of [
      "SUBMITTED",
      "COMPLETION_SUBMITTED",
      "COMPLETED",
      "REJECTED",
      "CANCELLED",
    ] as const) {
      it(`refuses a cost on a ${status} work order, and writes nothing`, async () => {
        const parked = await workOrderIn(status);
        const { response, entryId } = await recordRepairExpense(
          [{ assetId, workOrderId: parked, amountMinor: 5_000 }],
          5_000,
        );
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          error: {
            code: "WORK_ORDER_NOT_OPEN",
            metadata: { workOrderId: parked, status },
          },
        });
        expect(
          await db.select().from(financialEntries).where(eq(financialEntries.id, entryId)),
        ).toHaveLength(0);
      });
    }

    it("refuses a cancelled order reached through the real command", async () => {
      const cancelledId = await openWorkOrder(adminToken, assetId);
      expect(
        (
          await post(
            adminToken,
            "cancel-work-order",
            { workOrderId: cancelledId, reason: "Réparation abandonnée" },
            { expectedVersion: 1 },
          )
        ).statusCode,
      ).toBe(200);

      const { response } = await recordRepairExpense(
        [{ assetId, workOrderId: cancelledId, amountMinor: 5_000 }],
        5_000,
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "WORK_ORDER_NOT_OPEN", metadata: { status: "CANCELLED" } },
      });
    });
  });

  it("refuses a line whose asset is not the work order's asset", async () => {
    const { response } = await recordRepairExpense(
      [{ assetId: otherAssetId, workOrderId, amountMinor: 7_000 }],
      7_000,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "WORK_ORDER_ASSET_MISMATCH",
        metadata: { workOrderId, workOrderAssetId: assetId, assetId: otherAssetId },
      },
    });
  });

  describe("branch scope reads through the work order (#47 finding 3)", () => {
    it("refuses another branch's work order even with the asset omitted", async () => {
      const yaoundeOrder = await openWorkOrder(adminToken, yaoundeAssetId);
      const { response, entryId } = await recordRepairExpense(
        [{ workOrderId: yaoundeOrder, amountMinor: 9_000 }],
        9_000,
        doualaManagerToken,
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: {
          code: "ROLE_FORBIDDEN",
          metadata: { referenceType: "workOrder", workOrderId: yaoundeOrder },
        },
      });
      expect(
        await db.select().from(financialEntries).where(eq(financialEntries.id, entryId)),
      ).toHaveLength(0);
    });

    it("accepts the same manager's cost on a work order in their own branch", async () => {
      const { response } = await recordRepairExpense(
        [{ workOrderId, amountMinor: 9_000 }],
        9_000,
        doualaManagerToken,
      );
      expect(response.statusCode).toBe(200);
    });
  });

  describe("reversals carry the work order (#47 finding 4)", () => {
    it("puts the negative line on the same repair, even once the order is completed", async () => {
      const orderId = await openWorkOrder(adminToken, assetId);
      const { response, entryId } = await recordRepairExpense(
        [{ assetId, workOrderId: orderId, amountMinor: 40_000 }],
        40_000,
      );
      expect(response.json()).toMatchObject({ recordStatus: "POSTED" });

      // Closed to NEW cost — but a correction is always allowed.
      expect(
        (
          await post(
            adminToken,
            "complete-work-order",
            { workOrderId: orderId, actualCostMinor: 40_000 },
            { expectedVersion: 1 },
          )
        ).json(),
      ).toMatchObject({ recordStatus: "COMPLETED" });

      const reversalEntryId = randomUUID();
      const reversed = await post(
        approverToken,
        "reverse-entry",
        { originalEntryId: entryId, reversalEntryId, reason: "Facture en double" },
        { expectedVersion: 1 },
      );
      expect(reversed.statusCode).toBe(200);

      const reversalLines = await postingsOf(reversalEntryId);
      expect(reversalLines).toHaveLength(1);
      expect(reversalLines[0]).toMatchObject({
        workOrderId: orderId,
        assetId,
        amountMinor: -40_000n,
      });
    });
  });

  describe("MAINTENANCE records expenses only against work orders", () => {
    it("auto-posts a workshop expense within the field band when every line names a work order", async () => {
      const { response, entryId } = await recordRepairExpense(
        [
          { assetId, workOrderId, amountMinor: 30_000 },
          { workOrderId, amountMinor: 20_000 },
        ],
        50_000,
        maintenanceToken,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "POSTED" });
      expect(await postingsOf(entryId)).toHaveLength(2);
    });

    it("holds a workshop expense above the band for review", async () => {
      const { response } = await recordRepairExpense(
        [{ assetId, workOrderId, amountMinor: 150_000 }],
        150_000,
        maintenanceToken,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "SUBMITTED" });
    });

    it("refuses a workshop expense with a line that names no work order", async () => {
      for (const postings of [
        [{ assetId, amountMinor: 10_000 }],
        [
          { assetId, workOrderId, amountMinor: 5_000 },
          { assetId, amountMinor: 5_000 },
        ],
      ]) {
        const { response, entryId } = await recordRepairExpense(
          postings,
          10_000,
          maintenanceToken,
        );
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
          error: { code: "ROLE_FORBIDDEN", metadata: { reason: "WORK_ORDER_REQUIRED" } },
        });
        expect(
          await db.select().from(financialEntries).where(eq(financialEntries.id, entryId)),
        ).toHaveLength(0);
      }
    });

    it("refuses revenue from the workshop outright", async () => {
      const { response } = await recordRepairExpense(
        [{ assetId, workOrderId, amountMinor: 10_000 }],
        10_000,
        maintenanceToken,
        "record-revenue",
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "ROLE_FORBIDDEN", metadata: { command: "record-revenue.v1" } },
      });
    });
  });

  /**
   * The structural backstop under the handler check: even a writer that skipped
   * the command layer cannot attribute one tenant's cost to another tenant's
   * repair. `financial_postings_ws_work_order_fk` is a composite tenant FK, so
   * the pair (workspace_id, work_order_id) has to exist together.
   */
  it("cannot attribute a posting to another workspace's work order", async () => {
    const { response, entryId } = await recordRepairExpense(
      [{ assetId, workOrderId, amountMinor: 20_000 }],
      20_000,
    );
    expect(response.statusCode).toBe(200);

    const [existing] = await postingsOf(entryId);

    let code: string | undefined;
    try {
      await db.insert(financialPostings).values({
        ...existing!,
        id: randomUUID(),
        lineNo: existing!.lineNo + 1,
        workOrderId: otherWorkspaceWorkOrderId,
      });
    } catch (error) {
      const wrapped = error as { code?: string; cause?: { code?: string } };
      code = wrapped.cause?.code ?? wrapped.code;
    }
    expect(code).toBe("23503");
  });
});
