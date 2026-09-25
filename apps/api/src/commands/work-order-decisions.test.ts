import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, workOrders } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * The two work-order decisions, and the maker/checker split each enforces.
 * approve-work-order refuses the member who ASKED for the spend;
 * approve-work-order-closure refuses the member who DECLARED what it cost —
 * a different person, on a different question.
 */
describe("work-order decision commands", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let managerToken: string;
  let approverToken: string;
  let assetId: string;
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

    const manager = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    managerToken = (
      await createSession(db, { workspaceId, principalId: manager.principal.id })
    ).token;

    const approver = await seedMember(db, {
      workspaceId,
      role: "FINANCE_APPROVER",
      allBranches: true,
    });
    approverToken = (
      await createSession(db, {
        workspaceId,
        principalId: approver.principal.id,
      })
    ).token;

    assetId = await seedAsset(ctx.app, adminToken);

    /**
     * The tenant rule that makes these commands reachable at all: above
     * 100 000 XAF the finance approver is the role that authorizes, so neither
     * the manager nor the admin clears their own request. Left in place for the
     * whole suite — every order here is deliberately above the bound.
     */
    await db.insert(approvalRules).values(
      ["create-work-order", "complete-work-order"].map((commandType) => ({
        workspaceId,
        commandType,
        categoryCode: null,
        branchId: null,
        amountMinMinor: 100_000n,
        amountMaxMinor: null,
        requiredRole: "FINANCE_APPROVER" as const,
        createdByCommandId: null,
      })),
    );

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
    const foreignAssetId = await seedAsset(ctx.app, otherToken);
    otherWorkspaceWorkOrderId = randomUUID();
    expect(
      (
        await post(otherToken, "create-work-order", {
          workOrderId: otherWorkspaceWorkOrderId,
          assetId: foreignAssetId,
          description: "Révision chez le voisin",
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

  function readWorkOrder(workOrderId: string) {
    return db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  }

  /** A work order held at SUBMITTED by the suite's threshold rule. */
  async function submittedWorkOrder(token = managerToken): Promise<string> {
    const workOrderId = randomUUID();
    const response = await post(token, "create-work-order", {
      workOrderId,
      assetId,
      description: "Réfection complète du pont arrière",
      expectedCostMinor: 750_000,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordStatus: "SUBMITTED" });
    return workOrderId;
  }

  /** A work order carried through to PENDING_CLOSE by the named completer. */
  async function pendingCloseWorkOrder(
    completerToken: string,
    creatorToken = managerToken,
  ): Promise<string> {
    const workOrderId = await submittedWorkOrder(creatorToken);
    expect(
      (
        await post(
          approverToken,
          "approve-work-order",
          { workOrderId },
          { expectedVersion: 1 },
        )
      ).statusCode,
    ).toBe(200);
    const completed = await post(
      completerToken,
      "complete-work-order",
      { workOrderId, actualCostMinor: 812_000, summary: "Pont déposé et refait" },
      { expectedVersion: 2 },
    );
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ recordStatus: "PENDING_CLOSE" });
    return workOrderId;
  }

  describe("approve-work-order.v1", () => {
    it("authorizes the spend and opens the order", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(
        approverToken,
        "approve-work-order",
        { workOrderId, note: "Devis du garage validé" },
        { expectedVersion: 1 },
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordId: workOrderId,
        rowVersion: 2,
        recordStatus: "OPEN",
      });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "OPEN",
        rowVersion: 2,
      });
    });

    it("is closed to roles that are not approvers at all", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(
        managerToken,
        "approve-work-order",
        { workOrderId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "ROLE_FORBIDDEN" },
      });
    });

    /** The split is about the person, not the role: an admin may approve, but not their own. */
    it("refuses an approver who is the order's creator", async () => {
      const workOrderId = await submittedWorkOrder(adminToken);

      const response = await post(
        adminToken,
        "approve-work-order",
        { workOrderId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "MAKER_CANNOT_APPROVE" },
      });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "SUBMITTED",
        rowVersion: 1,
      });
    });

    it("refuses an order that is not waiting for authorization", async () => {
      const workOrderId = await submittedWorkOrder();
      expect(
        (
          await post(
            approverToken,
            "approve-work-order",
            { workOrderId },
            { expectedVersion: 1 },
          )
        ).statusCode,
      ).toBe(200);

      const again = await post(
        approverToken,
        "approve-work-order",
        { workOrderId },
        { expectedVersion: 2 },
      );
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "OPEN", to: "OPEN" },
        },
      });
    });

    it("rejects a stale version", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(
        approverToken,
        "approve-work-order",
        { workOrderId },
        { expectedVersion: 4 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { currentVersion: 1 } },
      });
    });

    it("cannot approve another workspace's order", async () => {
      const response = await post(
        approverToken,
        "approve-work-order",
        { workOrderId: otherWorkspaceWorkOrderId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: "REFERENCE_NOT_FOUND",
          metadata: { referenceType: "workOrder" },
        },
      });
    });
  });

  describe("approve-work-order-closure.v1", () => {
    it("accepts the declared costs and closes the order", async () => {
      const workOrderId = await pendingCloseWorkOrder(managerToken);
      const response = await post(
        approverToken,
        "approve-work-order-closure",
        { workOrderId, note: "Facture du garage vérifiée" },
        { expectedVersion: 3 },
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordId: workOrderId,
        rowVersion: 4,
        recordStatus: "CLOSED",
      });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "CLOSED",
        actualCostMinor: 812_000n,
        rowVersion: 4,
      });
    });

    it("refuses the member who declared the completion", async () => {
      const workOrderId = await pendingCloseWorkOrder(adminToken);
      const response = await post(
        adminToken,
        "approve-work-order-closure",
        { workOrderId },
        { expectedVersion: 3 },
      );

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "MAKER_CANNOT_APPROVE" },
      });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "PENDING_CLOSE",
        rowVersion: 3,
      });
    });

    /**
     * The creator is not the maker of THIS decision. What is being checked is
     * the money that was spent, and the admin who opened the order did not
     * write that number down — the manager who completed it did.
     */
    it("accepts an approver who merely created the order", async () => {
      const workOrderId = await pendingCloseWorkOrder(managerToken, adminToken);
      const response = await post(
        adminToken,
        "approve-work-order-closure",
        { workOrderId },
        { expectedVersion: 3 },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "CLOSED" });
    });

    it("refuses an order whose closure was never declared", async () => {
      const workOrderId = await submittedWorkOrder();
      expect(
        (
          await post(
            approverToken,
            "approve-work-order",
            { workOrderId },
            { expectedVersion: 1 },
          )
        ).statusCode,
      ).toBe(200);

      const response = await post(
        approverToken,
        "approve-work-order-closure",
        { workOrderId },
        { expectedVersion: 2 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "OPEN", to: "CLOSED" },
        },
      });
    });

    it("cannot approve another workspace's closure", async () => {
      const response = await post(
        approverToken,
        "approve-work-order-closure",
        { workOrderId: otherWorkspaceWorkOrderId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: "REFERENCE_NOT_FOUND",
          metadata: { referenceType: "workOrder" },
        },
      });
    });
  });
});
