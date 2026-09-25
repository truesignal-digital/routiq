import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, operationalIssues, workOrders } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * The work-order decisions (#28), and the maker/checker split each enforces.
 * approve-/reject-work-order refuse the member who ASKED for the spend;
 * approve-work-order-closure and reject-work-order-completion refuse the member
 * who DECLARED what it cost — a different person, on a different question.
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

  /** A work order carried through to COMPLETION_SUBMITTED by the named completer. */
  async function pendingCloseWorkOrder(
    completerToken: string,
    creatorToken = managerToken,
    extra: { issueId?: string; resolveLinkedIssue?: boolean } = {},
  ): Promise<string> {
    const workOrderId = randomUUID();
    const created = await post(creatorToken, "create-work-order", {
      workOrderId,
      assetId,
      description: "Réfection complète du pont arrière",
      expectedCostMinor: 750_000,
      ...(extra.issueId === undefined ? {} : { issueId: extra.issueId }),
    });
    expect(created.json()).toMatchObject({ recordStatus: "SUBMITTED" });
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
      {
        workOrderId,
        actualCostMinor: 812_000,
        summary: "Pont déposé et refait",
        ...(extra.resolveLinkedIssue === undefined
          ? {}
          : { resolveLinkedIssue: extra.resolveLinkedIssue }),
      },
      { expectedVersion: 2 },
    );
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
    return workOrderId;
  }

  describe("approve-work-order.v1", () => {
    it("authorizes the spend and approves the order", async () => {
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
        recordStatus: "APPROVED",
      });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "APPROVED",
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
          metadata: { from: "APPROVED", to: "APPROVED" },
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
    it("accepts the declared completion and completes the order", async () => {
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
        recordStatus: "COMPLETED",
      });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "COMPLETED",
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
        status: "COMPLETION_SUBMITTED",
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
      expect(response.json()).toMatchObject({ recordStatus: "COMPLETED" });
    });

    it("refuses an order whose completion was never declared", async () => {
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
          metadata: { from: "APPROVED", to: "COMPLETED" },
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

  /** A signalement on the suite's asset, for the resolve-on-completion flag. */
  async function reportIssue(): Promise<string> {
    const issueId = randomUUID();
    const response = await post(managerToken, "report-issue", {
      issueId,
      assetId,
      description: "Pont arrière bruyant",
      safetyCritical: false,
    });
    expect(response.statusCode).toBe(200);
    return issueId;
  }

  function readIssue(issueId: string) {
    return db.select().from(operationalIssues).where(eq(operationalIssues.id, issueId));
  }

  describe("approve-work-order-closure.v1 and the linked issue", () => {
    it("resolves the linked issue in the same transaction when the held completion asked for it", async () => {
      const issueId = await reportIssue();
      const workOrderId = await pendingCloseWorkOrder(managerToken, managerToken, {
        issueId,
      });
      // Held, not acted on: the flag waits for the approval.
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        resolveLinkedIssue: true,
      });
      expect((await readIssue(issueId))[0]).toMatchObject({ status: "OPEN" });

      const approved = await post(
        approverToken,
        "approve-work-order-closure",
        { workOrderId },
        { expectedVersion: 3 },
      );
      expect(approved.statusCode).toBe(200);
      const [issue] = await readIssue(issueId);
      expect(issue).toMatchObject({ status: "RESOLVED", rowVersion: 2 });
      expect(issue?.resolvedAt).toBeInstanceOf(Date);
    });

    it("leaves the issue open when the completer unchecked the flag", async () => {
      const issueId = await reportIssue();
      const workOrderId = await pendingCloseWorkOrder(managerToken, managerToken, {
        issueId,
        resolveLinkedIssue: false,
      });
      const approved = await post(
        approverToken,
        "approve-work-order-closure",
        { workOrderId },
        { expectedVersion: 3 },
      );
      expect(approved.statusCode).toBe(200);
      expect((await readIssue(issueId))[0]).toMatchObject({ status: "OPEN", rowVersion: 1 });
    });
  });

  describe("reject-work-order.v1", () => {
    it("refuses the spend, terminally, with its reason", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(
        approverToken,
        "reject-work-order",
        { workOrderId, reason: "Devis hors budget" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "REJECTED", rowVersion: 2 });
      const [workOrder] = await readWorkOrder(workOrderId);
      expect(workOrder).toMatchObject({
        status: "REJECTED",
        rejectReason: "Devis hors budget",
        rowVersion: 2,
      });
      expect(workOrder?.rejectedAt).toBeInstanceOf(Date);

      // Terminal: no approval, completion or cancellation reopens it.
      for (const [name, token, payload] of [
        ["approve-work-order", approverToken, { workOrderId }],
        ["reject-work-order", approverToken, { workOrderId, reason: "Encore" }],
        ["complete-work-order", managerToken, { workOrderId, actualCostMinor: 1 }],
        ["cancel-work-order", managerToken, { workOrderId, reason: "Trop tard" }],
      ] as const) {
        const again = await post(token, name, payload, { expectedVersion: 2 });
        expect(again.statusCode, name).toBe(409);
        expect(again.json(), name).toMatchObject({
          error: { code: "INVALID_STATE_TRANSITION", metadata: { from: "REJECTED" } },
        });
      }
    });

    it("requires a reason", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(
        approverToken,
        "reject-work-order",
        { workOrderId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    });

    it("refuses the member who asked for the spend", async () => {
      const workOrderId = await submittedWorkOrder(adminToken);
      const response = await post(
        adminToken,
        "reject-work-order",
        { workOrderId, reason: "Je me refuse" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "MAKER_CANNOT_APPROVE" } });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({ status: "SUBMITTED" });
    });

    it("is closed to the workshop roles", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(
        managerToken,
        "reject-work-order",
        { workOrderId, reason: "Non" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });

    it("refuses an order that is already approved", async () => {
      const workOrderId = await submittedWorkOrder();
      await post(approverToken, "approve-work-order", { workOrderId }, { expectedVersion: 1 });
      const response = await post(
        approverToken,
        "reject-work-order",
        { workOrderId, reason: "Changement d'avis" },
        { expectedVersion: 2 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "APPROVED", to: "REJECTED" },
        },
      });
    });
  });

  describe("reject-work-order-completion.v1", () => {
    it("sends the completion back to APPROVED, clears the held facts and keeps the reason", async () => {
      const workOrderId = await pendingCloseWorkOrder(managerToken);
      const response = await post(
        approverToken,
        "reject-work-order-completion",
        { workOrderId, reason: "Facture illisible" },
        { expectedVersion: 3 },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "APPROVED", rowVersion: 4 });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "APPROVED",
        actualCostMinor: null,
        summary: null,
        completedAt: null,
        resolveLinkedIssue: false,
        completionRejectReason: "Facture illisible",
        rowVersion: 4,
      });

      // Work stays open: the workshop resubmits, which clears the old reason.
      const resubmitted = await post(
        managerToken,
        "complete-work-order",
        { workOrderId, actualCostMinor: 790_000, summary: "Facture corrigée" },
        { expectedVersion: 4 },
      );
      expect(resubmitted.statusCode).toBe(200);
      expect(resubmitted.json()).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        completionRejectReason: null,
        actualCostMinor: 790_000n,
      });
    });

    it("refuses the member who declared the completion", async () => {
      const workOrderId = await pendingCloseWorkOrder(adminToken);
      const response = await post(
        adminToken,
        "reject-work-order-completion",
        { workOrderId, reason: "Auto-refus" },
        { expectedVersion: 3 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "MAKER_CANNOT_APPROVE" } });
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "COMPLETION_SUBMITTED",
      });
    });

    it("refuses an order with no completion waiting", async () => {
      const workOrderId = await submittedWorkOrder();
      const response = await post(
        approverToken,
        "reject-work-order-completion",
        { workOrderId, reason: "Rien à refuser" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "SUBMITTED", to: "APPROVED" },
        },
      });
    });

    it("requires a reason", async () => {
      const workOrderId = await pendingCloseWorkOrder(managerToken);
      const response = await post(
        approverToken,
        "reject-work-order-completion",
        { workOrderId, reason: "" },
        { expectedVersion: 3 },
      );
      expect(response.statusCode).toBe(400);
    });
  });

  describe("cancel-work-order.v1 from a pending completion", () => {
    it("calls off work whose completion is waiting for review", async () => {
      const workOrderId = await pendingCloseWorkOrder(managerToken);
      const response = await post(
        managerToken,
        "cancel-work-order",
        { workOrderId, reason: "Camion vendu en l'état" },
        { expectedVersion: 3 },
      );
      expect(response.statusCode).toBe(200);
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "CANCELLED",
        cancelReason: "Camion vendu en l'état",
      });
    });
  });
});
