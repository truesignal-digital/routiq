import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { financialPostings } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * How labour and parts reach the chronologie of the repair that incurred them
 * (§4.2): a posting line carries the work order, exactly as it already carries
 * the activity. One dimension on the line, never a second entry.
 */
describe("work-order cost attribution", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let assetId: string;
  let workOrderId: string;
  let otherWorkspaceId: string;
  let otherWorkspaceWorkOrderId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(db, { workspaceId, principalId: admin.principal.id })
    ).token;

    assetId = await seedAsset(ctx.app, adminToken);
    workOrderId = await openWorkOrder(adminToken, assetId);

    const otherSeeded = await seedWorkspace(db);
    otherWorkspaceId = otherSeeded.workspace.id;
    const otherAdmin = await seedMember(db, {
      workspaceId: otherWorkspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const otherToken = (
      await createSession(db, {
        workspaceId: otherWorkspaceId,
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
    return id;
  }

  function recordRepairExpense(
    postings: Array<Record<string, unknown>>,
    amountMinor: number,
  ) {
    return post(adminToken, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate: "2026-08-12",
      amountMinor,
      paymentMethod: "CASH",
      postings,
    });
  }

  it("writes the work order through to the posting line", async () => {
    const entryId = randomUUID();
    const response = await post(adminToken, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate: "2026-08-12",
      amountMinor: 58_000,
      paymentMethod: "CASH",
      postings: [{ assetId, workOrderId, amountMinor: 58_000 }],
    });

    expect(response.statusCode).toBe(200);
    const postings = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
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

    const postings = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
    expect(postings[0]?.workOrderId).toBeNull();
  });

  it("refuses a work order from another workspace", async () => {
    const response = await recordRepairExpense(
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

  it("refuses a cancelled work order", async () => {
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

    const response = await recordRepairExpense(
      [{ assetId, workOrderId: cancelledId, amountMinor: 5_000 }],
      5_000,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVALID_STATE_TRANSITION",
        metadata: { referenceType: "workOrder", from: "CANCELLED" },
      },
    });
  });

  /**
   * The structural backstop under the handler check: even a writer that skipped
   * the command layer cannot attribute one tenant's cost to another tenant's
   * repair. `financial_postings_ws_work_order_fk` is a composite tenant FK, so
   * the pair (workspace_id, work_order_id) has to exist together.
   */
  it("cannot attribute a posting to another workspace's work order", async () => {
    const entryId = randomUUID();
    expect(
      (
        await post(adminToken, "record-expense", {
          entryId,
          branchCode: "DLA",
          categoryCode: "REPAIRS",
          economicDate: "2026-08-12",
          amountMinor: 20_000,
          paymentMethod: "CASH",
          postings: [{ assetId, workOrderId, amountMinor: 20_000 }],
        })
      ).statusCode,
    ).toBe(200);

    const [existing] = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));

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
