import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, assets, workOrders } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * The work-order lifecycle facts: opening the job, declaring it finished,
 * calling it off — and the approval fork that decides whether each of the first
 * two lands in its pending state or straight in its terminal one.
 */
describe("work-order commands", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let managerToken: string;
  let assetId: string;
  let otherAssetId: string;
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

    assetId = await seedAsset(ctx.app, adminToken);
    otherAssetId = await seedAsset(ctx.app, adminToken);

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

  async function openWorkOrder(
    token = managerToken,
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    const workOrderId = randomUUID();
    const response = await post(token, "create-work-order", {
      workOrderId,
      assetId,
      description: "Remplacement plaquettes",
      ...payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordStatus: "OPEN" });
    return workOrderId;
  }

  /** A tenant threshold rule: above the bound, only an admin may authorize. */
  async function withThreshold<T>(
    commandType: string,
    amountMinMinor: bigint,
    run: () => Promise<T>,
  ): Promise<T> {
    const [rule] = await db
      .insert(approvalRules)
      .values({
        workspaceId,
        commandType,
        categoryCode: null,
        branchId: null,
        amountMinMinor,
        amountMaxMinor: null,
        requiredRole: "ADMIN",
        createdByCommandId: null,
      })
      .returning({ id: approvalRules.id });
    try {
      return await run();
    } finally {
      await db.delete(approvalRules).where(eq(approvalRules.id, rule!.id));
    }
  }

  function readWorkOrder(workOrderId: string) {
    return db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  }

  describe("create-work-order.v1", () => {
    it("opens the order directly under the catalog defaults", async () => {
      const workOrderId = randomUUID();
      const response = await post(managerToken, "create-work-order", {
        workOrderId,
        assetId,
        description: "Vidange moteur",
        expectedCostMinor: 45_000,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordId: workOrderId,
        rowVersion: 1,
        recordStatus: "OPEN",
        warnings: [],
      });

      const [workOrder] = await readWorkOrder(workOrderId);
      expect(workOrder).toMatchObject({
        workspaceId,
        assetId,
        issueId: null,
        status: "OPEN",
        expectedCostMinor: 45_000n,
        currency: "XAF",
        rowVersion: 1,
      });
    });

    it("submits instead of opening once a threshold rule covers the expected cost", async () => {
      await withThreshold("create-work-order", 100_000n, async () => {
        const submittedId = randomUUID();
        const submitted = await post(managerToken, "create-work-order", {
          workOrderId: submittedId,
          assetId,
          description: "Réfection boîte de vitesses",
          expectedCostMinor: 850_000,
        });
        expect(submitted.statusCode).toBe(200);
        expect(submitted.json()).toMatchObject({ recordStatus: "SUBMITTED" });
        expect((await readWorkOrder(submittedId))[0]).toMatchObject({
          status: "SUBMITTED",
          expectedCostMinor: 850_000n,
        });

        // The same manager, below the bound, is still authorized outright.
        const autoId = randomUUID();
        const auto = await post(managerToken, "create-work-order", {
          workOrderId: autoId,
          assetId,
          description: "Changement filtre à air",
          expectedCostMinor: 12_000,
        });
        expect(auto.statusCode).toBe(200);
        expect(auto.json()).toMatchObject({ recordStatus: "OPEN" });
      });
    });

    it("refuses an issue reported against a different asset", async () => {
      const issueId = randomUUID();
      expect(
        (
          await post(managerToken, "report-issue", {
            issueId,
            assetId: otherAssetId,
            description: "Bruit de roulement",
            safetyCritical: false,
          })
        ).statusCode,
      ).toBe(200);

      const response = await post(managerToken, "create-work-order", {
        workOrderId: randomUUID(),
        assetId,
        issueId,
        description: "Travaux sur le mauvais camion",
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "ISSUE_ASSET_MISMATCH" },
      });
    });

    it("refuses an unknown issue", async () => {
      const response = await post(managerToken, "create-work-order", {
        workOrderId: randomUUID(),
        assetId,
        issueId: randomUUID(),
        description: "Travaux sur un signalement inexistant",
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: "REFERENCE_NOT_FOUND",
          metadata: { referenceType: "operationalIssue" },
        },
      });
    });

    it("refuses a new order on a disposed asset", async () => {
      const soldAssetId = await seedAsset(ctx.app, adminToken);
      await db
        .update(assets)
        .set({ lifecycleStatus: "WRITTEN_OFF" })
        .where(eq(assets.id, soldAssetId));

      const response = await post(managerToken, "create-work-order", {
        workOrderId: randomUUID(),
        assetId: soldAssetId,
        description: "Réparer une épave",
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "ASSET_NOT_OPERATIONAL" },
      });
    });
  });

  describe("complete-work-order.v1", () => {
    it("closes the order and stamps the declared cost", async () => {
      const workOrderId = await openWorkOrder();
      const response = await post(
        managerToken,
        "complete-work-order",
        {
          workOrderId,
          actualCostMinor: 62_500,
          summary: "Plaquettes et disques avant remplacés",
        },
        { expectedVersion: 1 },
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordId: workOrderId,
        rowVersion: 2,
        recordStatus: "CLOSED",
      });

      const [workOrder] = await readWorkOrder(workOrderId);
      expect(workOrder).toMatchObject({
        status: "CLOSED",
        actualCostMinor: 62_500n,
        summary: "Plaquettes et disques avant remplacés",
        rowVersion: 2,
      });
      expect(workOrder?.completedAt).toBeInstanceOf(Date);
    });

    /**
     * The declared cost is exactly what the approver is being asked to look at,
     * so it is stamped on the transition attempt rather than waiting for the
     * approval that reads it.
     */
    it("holds the closure pending, with the cost already on the row", async () => {
      const workOrderId = await openWorkOrder();
      await withThreshold("complete-work-order", 100_000n, async () => {
        const response = await post(
          managerToken,
          "complete-work-order",
          {
            workOrderId,
            actualCostMinor: 640_000,
            summary: "Boîte reconditionnée",
          },
          { expectedVersion: 1 },
        );
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          recordStatus: "PENDING_CLOSE",
          rowVersion: 2,
        });

        const [workOrder] = await readWorkOrder(workOrderId);
        expect(workOrder).toMatchObject({
          status: "PENDING_CLOSE",
          actualCostMinor: 640_000n,
          summary: "Boîte reconditionnée",
        });
        expect(workOrder?.completedAt).toBeInstanceOf(Date);
      });
    });

    it("refuses to complete a cancelled order", async () => {
      const workOrderId = await openWorkOrder();
      expect(
        (
          await post(
            managerToken,
            "cancel-work-order",
            { workOrderId, reason: "Camion vendu avant réparation" },
            { expectedVersion: 1 },
          )
        ).statusCode,
      ).toBe(200);

      const response = await post(
        managerToken,
        "complete-work-order",
        { workOrderId, actualCostMinor: 1_000 },
        { expectedVersion: 2 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "CANCELLED", to: "CLOSED" },
        },
      });
    });

    it("requires the order's version, and rejects a stale one", async () => {
      const workOrderId = await openWorkOrder();

      const missing = await post(managerToken, "complete-work-order", {
        workOrderId,
        actualCostMinor: 5_000,
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({
        error: { code: "EXPECTED_VERSION_REQUIRED" },
      });

      const stale = await post(
        managerToken,
        "complete-work-order",
        { workOrderId, actualCostMinor: 5_000 },
        { expectedVersion: 9 },
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { currentVersion: 1 } },
      });
    });

    it("cannot complete another workspace's order", async () => {
      const response = await post(
        managerToken,
        "complete-work-order",
        { workOrderId: otherWorkspaceWorkOrderId, actualCostMinor: 1_000 },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: "REFERENCE_NOT_FOUND",
          metadata: { referenceType: "workOrder" },
        },
      });

      const [untouched] = await readWorkOrder(otherWorkspaceWorkOrderId);
      expect(untouched).toMatchObject({ status: "OPEN", rowVersion: 1 });
    });
  });

  describe("cancel-work-order.v1", () => {
    it("cancels an open order with its reason", async () => {
      const workOrderId = await openWorkOrder();
      const response = await post(
        managerToken,
        "cancel-work-order",
        { workOrderId, reason: "Pièce indisponible à Douala" },
        { expectedVersion: 1 },
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordStatus: "CANCELLED",
        rowVersion: 2,
      });

      const [workOrder] = await readWorkOrder(workOrderId);
      expect(workOrder).toMatchObject({
        status: "CANCELLED",
        cancelReason: "Pièce indisponible à Douala",
        rowVersion: 2,
      });
      expect(workOrder?.cancelledAt).toBeInstanceOf(Date);
    });

    it("refuses to cancel a closed order", async () => {
      const workOrderId = await openWorkOrder();
      expect(
        (
          await post(
            managerToken,
            "complete-work-order",
            { workOrderId, actualCostMinor: 8_000 },
            { expectedVersion: 1 },
          )
        ).statusCode,
      ).toBe(200);

      const response = await post(
        managerToken,
        "cancel-work-order",
        { workOrderId, reason: "Trop tard" },
        { expectedVersion: 2 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "CLOSED", to: "CANCELLED" },
        },
      });

      const [workOrder] = await readWorkOrder(workOrderId);
      expect(workOrder).toMatchObject({ status: "CLOSED", cancelReason: null });
    });

    it("cancels an order still waiting for authorization", async () => {
      const workOrderId = randomUUID();
      await withThreshold("create-work-order", 100_000n, async () => {
        const created = await post(managerToken, "create-work-order", {
          workOrderId,
          assetId,
          description: "Devis trop cher",
          expectedCostMinor: 900_000,
        });
        expect(created.json()).toMatchObject({ recordStatus: "SUBMITTED" });
      });

      const response = await post(
        managerToken,
        "cancel-work-order",
        { workOrderId, reason: "Devis refusé, autre garage" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(200);
      expect((await readWorkOrder(workOrderId))[0]).toMatchObject({
        status: "CANCELLED",
      });
    });
  });
});
