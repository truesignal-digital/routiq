import { randomUUID } from "node:crypto";
import {
  issueListResponse,
  workOrderDetail,
  workOrderListResponse,
} from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("work order and signalement reads", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let managerToken: string;
  let doualaToken: string;
  let adminPrincipalId: string;
  let managerPrincipalId: string;
  let doualaBranchId: string;
  let yaoundeBranchId: string;
  let dlaAssetId: string;
  let ydeAssetId: string;
  let flipAssetId: string;

  let safetyIssueId: string;
  let minorIssueId: string;
  let ydeIssueId: string;
  let flipIssueId: string;

  let lifecycleWorkOrderId: string;
  let cancelledWorkOrderId: string;
  let decoyWorkOrderId: string;
  let ydeWorkOrderId: string;
  let flipWorkOrderId: string;

  let otherWorkspaceWorkOrderId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    doualaBranchId = seeded.branch.id;

    const [yaounde] = await db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");
    yaoundeBranchId = yaounde.id;

    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminPrincipalId = admin.principal.id;
    adminToken = (
      await createSession(db, { workspaceId, principalId: adminPrincipalId })
    ).token;

    const manager = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    managerPrincipalId = manager.principal.id;
    managerToken = (
      await createSession(db, { workspaceId, principalId: managerPrincipalId })
    ).token;

    // Branch-scoped reader: the lens, not a filter — she must never see YDE.
    const doualaMember = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      branchIds: [doualaBranchId],
    });
    doualaToken = (
      await createSession(db, {
        workspaceId,
        principalId: doualaMember.principal.id,
      })
    ).token;

    dlaAssetId = await seedAsset(ctx.app, adminToken, {
      assetCode: "WO-TRACTOR",
    });
    ydeAssetId = await seedAsset(ctx.app, adminToken, {
      assetCode: "WO-YDE",
      branchCode: "YDE",
    });
    flipAssetId = await seedAsset(ctx.app, adminToken, {
      assetCode: "WO-GROUNDED",
    });

    safetyIssueId = randomUUID();
    await command(managerToken, "report-issue", {
      issueId: safetyIssueId,
      assetId: dlaAssetId,
      description: "Fuite de liquide de frein",
      safetyCritical: true,
      category: "BRAKES",
    });

    minorIssueId = randomUUID();
    await command(managerToken, "report-issue", {
      issueId: minorIssueId,
      assetId: dlaAssetId,
      description: "Rétroviseur fissuré",
      safetyCritical: false,
    });

    ydeIssueId = randomUUID();
    await command(managerToken, "report-issue", {
      issueId: ydeIssueId,
      assetId: ydeAssetId,
      description: "Climatisation en panne",
      safetyCritical: false,
    });

    // The full story: a threshold rule forces both the opening and the closure
    // through a human, so the chronologie carries every event kind at once.
    lifecycleWorkOrderId = randomUUID();
    await withThresholds(async () => {
      const created = await command(managerToken, "create-work-order", {
        workOrderId: lifecycleWorkOrderId,
        assetId: dlaAssetId,
        issueId: safetyIssueId,
        description: "Réfection du circuit de freinage",
        expectedCostMinor: 850_000,
      });
      const approved = await command(
        adminToken,
        "approve-work-order",
        { workOrderId: lifecycleWorkOrderId, note: "Devis validé" },
        { expectedVersion: created.rowVersion },
      );
      // Costs attach while the order is APPROVED (#28) — before completion.
      await command(adminToken, "record-expense", {
        entryId: randomUUID(),
        branchCode: "DLA",
        categoryCode: "REPAIRS",
        economicDate: "2026-08-13",
        amountMinor: 900_000,
        paymentMethod: "BANK",
        description: "Pièces et main-d'œuvre freinage",
        postings: [
          { assetId: dlaAssetId, workOrderId: lifecycleWorkOrderId, amountMinor: 900_000 },
        ],
      });
      const completed = await command(
        managerToken,
        "complete-work-order",
        {
          workOrderId: lifecycleWorkOrderId,
          actualCostMinor: 900_000,
          summary: "Maître-cylindre et flexibles remplacés",
        },
        { expectedVersion: approved.rowVersion },
      );
      await command(
        adminToken,
        "approve-work-order-closure",
        { workOrderId: lifecycleWorkOrderId, note: "Facture conforme" },
        { expectedVersion: completed.rowVersion },
      );
    });
    // Releaser ≠ performer: the manager declared it complete, the admin signs
    // the truck back into service.
    await command(adminToken, "release-asset-to-service", {
      assetId: dlaAssetId,
      workOrderId: lifecycleWorkOrderId,
      note: "Essai routier concluant",
    });

    cancelledWorkOrderId = randomUUID();
    const cancellable = await command(managerToken, "create-work-order", {
      workOrderId: cancelledWorkOrderId,
      assetId: dlaAssetId,
      description: "Peinture de la cabine",
    });
    await command(
      managerToken,
      "cancel-work-order",
      {
        workOrderId: cancelledWorkOrderId,
        reason: "Reporté à la prochaine immobilisation",
      },
      { expectedVersion: cancellable.rowVersion },
    );

    decoyWorkOrderId = randomUUID();
    await command(managerToken, "create-work-order", {
      workOrderId: decoyWorkOrderId,
      assetId: dlaAssetId,
      description: "Vidange moteur",
      expectedCostMinor: 45_000,
    });

    ydeWorkOrderId = randomUUID();
    await command(managerToken, "create-work-order", {
      workOrderId: ydeWorkOrderId,
      assetId: ydeAssetId,
      description: "Recharge de climatisation",
    });

    // A second order on the same asset carries its own cost; the lifecycle
    // order's detail must not show it.
    await command(adminToken, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate: "2026-08-14",
      amountMinor: 45_000,
      paymentMethod: "CASH",
      description: "Huile et filtre",
      postings: [
        { assetId: dlaAssetId, workOrderId: decoyWorkOrderId, amountMinor: 45_000 },
      ],
    });

    // Still grounded at the end of setup: the release happens inside the test
    // that watches the flag flip.
    flipIssueId = randomUUID();
    await command(managerToken, "report-issue", {
      issueId: flipIssueId,
      assetId: flipAssetId,
      description: "Direction qui vibre à haute vitesse",
      safetyCritical: true,
    });
    flipWorkOrderId = randomUUID();
    const flipCreated = await command(managerToken, "create-work-order", {
      workOrderId: flipWorkOrderId,
      assetId: flipAssetId,
      issueId: flipIssueId,
      description: "Géométrie et rotules",
    });
    await command(
      managerToken,
      "complete-work-order",
      {
        workOrderId: flipWorkOrderId,
        actualCostMinor: 120_000,
        summary: "Rotules remplacées, parallélisme repris",
      },
      { expectedVersion: flipCreated.rowVersion },
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
    const otherAssetId = await seedAsset(ctx.app, otherToken, {
      assetCode: "OTHER-TRUCK",
    });
    const otherIssueId = randomUUID();
    await command(otherToken, "report-issue", {
      issueId: otherIssueId,
      assetId: otherAssetId,
      description: "Ne doit jamais apparaître",
      safetyCritical: true,
    });
    otherWorkspaceWorkOrderId = randomUUID();
    await command(otherToken, "create-work-order", {
      workOrderId: otherWorkspaceWorkOrderId,
      assetId: otherAssetId,
      issueId: otherIssueId,
      description: "Ne doit jamais apparaître",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function command(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    const response = await ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `maintenance-read-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...envelope,
        },
        payload,
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(`${name} failed: ${response.statusCode} ${response.body}`);
    }
    return response.json() as { rowVersion: number; recordStatus?: string };
  }

  /**
   * Tenant threshold rules on both creation and completion: above the bound only
   * an admin may authorize, which is what puts SUBMITTED and COMPLETION_SUBMITTED — and
   * their approval events — on the timeline.
   */
  async function withThresholds<T>(run: () => Promise<T>): Promise<T> {
    const inserted = await db
      .insert(approvalRules)
      .values(
        ["create-work-order", "complete-work-order"].map((commandType) => ({
          workspaceId,
          commandType,
          categoryCode: null,
          branchId: null,
          amountMinMinor: 100_000n,
          amountMaxMinor: null,
          requiredRole: "ADMIN" as const,
          createdByCommandId: null,
        })),
      )
      .returning({ id: approvalRules.id });
    try {
      return await run();
    } finally {
      for (const rule of inserted) {
        await db.delete(approvalRules).where(eq(approvalRules.id, rule.id));
      }
    }
  }

  async function listWorkOrders(query = "", token = adminToken) {
    const response = await ctx.app.inject({
      method: "GET",
      url: query === "" ? "/v1/work-orders" : `/v1/work-orders?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return workOrderListResponse.parse(response.json());
  }

  async function listIssues(query = "", token = adminToken) {
    const response = await ctx.app.inject({
      method: "GET",
      url: query === "" ? "/v1/issues" : `/v1/issues?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return issueListResponse.parse(response.json());
  }

  async function detail(workOrderId: string, token = adminToken) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/work-orders/${workOrderId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return response;
  }

  describe("GET /v1/work-orders", () => {
    it("lists every order newest first with its asset, branch and costs", async () => {
      const response = await listWorkOrders();

      expect(response.items.map((item) => item.id)).toEqual([
        flipWorkOrderId,
        ydeWorkOrderId,
        decoyWorkOrderId,
        cancelledWorkOrderId,
        lifecycleWorkOrderId,
      ]);
      expect(response.nextCursor).toBeNull();

      const lifecycle = response.items.find(
        (item) => item.id === lifecycleWorkOrderId,
      );
      expect(lifecycle).toMatchObject({
        status: "COMPLETED",
        description: "Réfection du circuit de freinage",
        asset: {
          id: dlaAssetId,
          assetCode: "WO-TRACTOR",
          registrationNumber: null,
        },
        branch: { id: doualaBranchId, code: "DLA", name: "Douala" },
        expectedCostMinor: 850_000,
        actualCostMinor: 900_000,
        currency: "XAF",
        issue: { id: safetyIssueId, safetyCritical: true },
        cancelledAt: null,
      });
      expect(lifecycle?.completedAt).not.toBeNull();
      expect(lifecycle?.rowVersion).toBeGreaterThan(1);
    });

    it("carries no issue link for preventive work", async () => {
      const response = await listWorkOrders(`assetId=${ydeAssetId}`);
      expect(response.items).toHaveLength(1);
      expect(response.items[0]).toMatchObject({
        id: ydeWorkOrderId,
        issue: null,
        expectedCostMinor: null,
        actualCostMinor: null,
      });
    });

    it("filters by status for the queue's chips", async () => {
      expect(
        (await listWorkOrders("status=CANCELLED")).items.map((item) => item.id),
      ).toEqual([cancelledWorkOrderId]);
      expect(
        (await listWorkOrders("status=COMPLETED")).items.map((item) => item.id),
      ).toEqual([flipWorkOrderId, lifecycleWorkOrderId]);
      expect(
        (await listWorkOrders("status=APPROVED")).items.map((item) => item.id),
      ).toEqual([ydeWorkOrderId, decoyWorkOrderId]);
    });

    it("filters by branch through the asset that carries it", async () => {
      expect(
        (await listWorkOrders(`branchId=${yaoundeBranchId}`)).items.map(
          (item) => item.id,
        ),
      ).toEqual([ydeWorkOrderId]);
    });

    it("hides orders outside the caller's branch scope", async () => {
      const scoped = await listWorkOrders("", doualaToken);
      expect(scoped.items.map((item) => item.id)).not.toContain(ydeWorkOrderId);
      expect(scoped.items.map((item) => item.id)).toContain(
        lifecycleWorkOrderId,
      );

      // A branchId outside the lens narrows to nothing; it can never widen it.
      expect(
        (await listWorkOrders(`branchId=${yaoundeBranchId}`, doualaToken)).items,
      ).toEqual([]);
    });

    it("never shows another workspace's orders", async () => {
      const ids = (await listWorkOrders()).items.map((item) => item.id);
      expect(ids).not.toContain(otherWorkspaceWorkOrderId);
    });

    it("walks the queue with a stable keyset cursor", async () => {
      const first = await listWorkOrders("limit=2");
      expect(first.items.map((item) => item.id)).toEqual([
        flipWorkOrderId,
        ydeWorkOrderId,
      ]);
      expect(first.nextCursor).not.toBeNull();

      const second = await listWorkOrders(
        `limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      );
      expect(second.items.map((item) => item.id)).toEqual([
        decoyWorkOrderId,
        cancelledWorkOrderId,
      ]);

      const third = await listWorkOrders(
        `limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`,
      );
      expect(third.items.map((item) => item.id)).toEqual([lifecycleWorkOrderId]);
      expect(third.nextCursor).toBeNull();
    });

    it("rejects a cursor that was not minted for this queue", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/work-orders?cursor=not-a-cursor",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "VALIDATION_FAILED" },
      });
    });
  });

  describe("GET /v1/work-orders/:id", () => {
    it("assembles the chronologie from every event the workflow wrote", async () => {
      const response = await detail(lifecycleWorkOrderId);
      expect(response.statusCode).toBe(200);
      const body = workOrderDetail.parse(response.json());

      expect(body.chronologie.map((event) => event.kind)).toEqual([
        "work_order.submitted",
        "work_order.approved",
        "work_order.completion_submitted",
        "work_order.completion_approved",
        "work_order.asset_released",
      ]);

      const occurrences = body.chronologie.map((event) =>
        Date.parse(event.occurredAt),
      );
      expect(occurrences).toEqual([...occurrences].sort((a, b) => a - b));

      expect(body.chronologie.map((event) => event.actor.principalId)).toEqual([
        managerPrincipalId,
        adminPrincipalId,
        managerPrincipalId,
        adminPrincipalId,
        adminPrincipalId,
      ]);
      for (const event of body.chronologie) {
        expect(event.actor.scope).toBe("WORKSPACE");
        expect(event.actor.displayName).toEqual(expect.any(String));
      }
    });

    it("carries the completion summary and the header the list already shows", async () => {
      const body = workOrderDetail.parse((await detail(lifecycleWorkOrderId)).json());
      expect(body).toMatchObject({
        id: lifecycleWorkOrderId,
        status: "COMPLETED",
        summary: "Maître-cylindre et flexibles remplacés",
        cancelReason: null,
        rejectReason: null,
        completionRejectReason: null,
        resolveLinkedIssue: true,
        actualCostMinor: 900_000,
        issue: { id: safetyIssueId, safetyCritical: true },
        branch: { code: "DLA" },
      });
      expect(body.createdByCommandId).toEqual(expect.any(String));
    });

    it("joins only the postings that carry this work order", async () => {
      const body = workOrderDetail.parse((await detail(lifecycleWorkOrderId)).json());

      expect(body.costLines).toHaveLength(1);
      expect(body.costLines[0]).toMatchObject({
        description: "Pièces et main-d'œuvre freinage",
        amountMinor: 900_000,
        currency: "XAF",
        economicDate: "2026-08-13",
        entryStatus: "POSTED",
      });

      const decoy = workOrderDetail.parse((await detail(decoyWorkOrderId)).json());
      expect(decoy.costLines.map((line) => line.amountMinor)).toEqual([45_000]);
    });

    it("shows a cancellation as a reason plus a two-step timeline", async () => {
      const body = workOrderDetail.parse((await detail(cancelledWorkOrderId)).json());
      expect(body.status).toBe("CANCELLED");
      expect(body.cancelReason).toBe("Reporté à la prochaine immobilisation");
      expect(body.cancelledAt).not.toBeNull();
      expect(body.chronologie.map((event) => event.kind)).toEqual([
        "work_order.created",
        "work_order.cancelled",
      ]);
      expect(body.costLines).toEqual([]);
    });

    it("404s on another workspace's order", async () => {
      const response = await detail(otherWorkspaceWorkOrderId);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: { code: "REFERENCE_NOT_FOUND" },
      });
    });

    it("404s on an order outside the caller's branch scope", async () => {
      expect((await detail(ydeWorkOrderId, doualaToken)).statusCode).toBe(404);
      expect((await detail(ydeWorkOrderId)).statusCode).toBe(200);
    });
  });

  describe("GET /v1/issues", () => {
    it("lists signalements newest first with their work orders", async () => {
      const response = await listIssues(`assetId=${dlaAssetId}`);

      expect(response.items.map((item) => item.id)).toEqual([
        minorIssueId,
        safetyIssueId,
      ]);
      expect(response.items[1]).toMatchObject({
        id: safetyIssueId,
        asset: { id: dlaAssetId, assetCode: "WO-TRACTOR" },
        branch: { id: doualaBranchId, code: "DLA" },
        description: "Fuite de liquide de frein",
        safetyCritical: true,
        category: "BRAKES",
        // Resolved by the approved completion that asked for it (#28).
        status: "RESOLVED",
        dismissReason: null,
        workOrders: [{ id: lifecycleWorkOrderId, status: "COMPLETED" }],
        // Already released during setup.
        assetUnavailable: false,
      });
      expect(response.items[0]).toMatchObject({
        safetyCritical: false,
        category: null,
        status: "OPEN",
        resolvedAt: null,
        workOrders: [],
        assetUnavailable: false,
      });
    });

    it("filters by the signalement's own status", async () => {
      expect(
        (await listIssues("status=RESOLVED")).items.map((item) => item.id),
      ).toEqual([flipIssueId, safetyIssueId]);
      expect(
        (await listIssues("status=OPEN")).items.map((item) => item.id),
      ).toEqual([ydeIssueId, minorIssueId]);
      expect((await listIssues("status=DISMISSED")).items).toEqual([]);

      const bad = await ctx.app.inject({
        method: "GET",
        url: "/v1/issues?status=TRIAGED",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(bad.statusCode).toBe(400);
    });

    it("filters by safety criticality and by branch through the asset", async () => {
      expect(
        (await listIssues("safetyCritical=true")).items.map((item) => item.id),
      ).toEqual([flipIssueId, safetyIssueId]);
      expect(
        (await listIssues(`branchId=${yaoundeBranchId}`)).items.map(
          (item) => item.id,
        ),
      ).toEqual([ydeIssueId]);
    });

    it("hides signalements outside the caller's branch scope", async () => {
      const ids = (await listIssues("", doualaToken)).items.map(
        (item) => item.id,
      );
      expect(ids).not.toContain(ydeIssueId);
      expect(ids).toContain(safetyIssueId);
    });

    it("never shows another workspace's signalements", async () => {
      const descriptions = (await listIssues()).items.map(
        (item) => item.description,
      );
      expect(descriptions).not.toContain("Ne doit jamais apparaître");
    });

    it("clears the unavailability flag once the asset is released", async () => {
      const grounded = (await listIssues(`assetId=${flipAssetId}`)).items;
      expect(grounded).toHaveLength(1);
      expect(grounded[0]).toMatchObject({
        id: flipIssueId,
        safetyCritical: true,
        assetUnavailable: true,
        workOrders: [{ id: flipWorkOrderId, status: "COMPLETED" }],
      });

      await command(adminToken, "release-asset-to-service", {
        assetId: flipAssetId,
        workOrderId: flipWorkOrderId,
      });

      const released = (await listIssues(`assetId=${flipAssetId}`)).items;
      expect(released[0]?.assetUnavailable).toBe(false);
    });
  });

  /**
   * C.1: a cost line is a financial record. The entry's branch is read against
   * the reader's scope, and the lines are split by what finance decided:
   * posted (POSTED plus both halves of a reversal), pending (SUBMITTED), and
   * refused (REJECTED — not a cost at all).
   */
  describe("GET /v1/work-orders/:id cost lines", () => {
    let costOrderId: string;

    beforeAll(async () => {
      costOrderId = randomUUID();
      await command(managerToken, "create-work-order", {
        workOrderId: costOrderId,
        assetId: dlaAssetId,
        description: "Embrayage",
      });
      const expense = (
        token: string,
        branchCode: string,
        amountMinor: number,
        description: string,
        entryId = randomUUID(),
      ) =>
        command(token, "record-expense", {
          entryId,
          branchCode,
          categoryCode: "REPAIRS",
          economicDate: "2026-08-15",
          amountMinor,
          paymentMethod: "CASH",
          description,
          postings: [{ workOrderId: costOrderId, amountMinor }],
        }).then((result) => ({ ...result, entryId }));

      await expense(adminToken, "DLA", 30_000, "Disque d'embrayage");
      // Paid by the Yaoundé agency for a Douala truck: a Yaoundé record.
      await expense(adminToken, "YDE", 12_000, "Kit payé à Yaoundé");

      const reversed = await expense(adminToken, "DLA", 8_000, "Saisi deux fois");
      await command(
        adminToken,
        "reverse-entry",
        { originalEntryId: reversed.entryId, reversalEntryId: randomUUID(), reason: "Doublon" },
        { expectedVersion: 1 },
      );

      // Above the field band: waits for finance.
      await expense(managerToken, "DLA", 150_000, "Main-d'œuvre garage");

      const refused = await expense(managerToken, "DLA", 200_000, "Facture refusée");
      await command(
        adminToken,
        "reject-entry",
        { entryId: refused.entryId, reason: "Pas de justificatif" },
        { expectedVersion: 1 },
      );
    });

    it("separates posted, pending and refused spend", async () => {
      const body = workOrderDetail.parse((await detail(costOrderId)).json());

      expect(
        body.costLines.map((line) => [line.description, line.amountMinor, line.entryStatus]),
      ).toEqual(
        expect.arrayContaining([
          ["Disque d'embrayage", 30_000, "POSTED"],
          ["Kit payé à Yaoundé", 12_000, "POSTED"],
          ["Saisi deux fois", 8_000, "REVERSED"],
          ["Saisi deux fois", -8_000, "POSTED"],
        ]),
      );
      expect(body.costLines).toHaveLength(4);
      // Signed lines sum to what the repair cost: the reversal pair nets out.
      expect(body.costLines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(42_000);

      expect(
        body.pendingCostLines.map((line) => [line.description, line.amountMinor]),
      ).toEqual([["Main-d'œuvre garage", 150_000]]);
      expect(
        [...body.costLines, ...body.pendingCostLines].map((line) => line.description),
      ).not.toContain("Facture refusée");
    });

    it("drops the lines booked in a branch the reader cannot see", async () => {
      const scoped = workOrderDetail.parse((await detail(costOrderId, doualaToken)).json());
      expect(scoped.costLines.map((line) => line.description)).not.toContain(
        "Kit payé à Yaoundé",
      );
      expect(scoped.costLines).toHaveLength(3);
      expect(scoped.pendingCostLines).toHaveLength(1);
    });
  });

  describe("module entitlement", () => {
    it("answers MODULE_DISABLED on every maintenance read once the module is off", async () => {
      const seeded = await seedWorkspace(db);
      const admin = await seedMember(db, {
        workspaceId: seeded.workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      const gatedToken = (
        await createSession(db, {
          workspaceId: seeded.workspace.id,
          principalId: admin.principal.id,
        })
      ).token;

      for (const url of ["/v1/work-orders", "/v1/issues", `/v1/work-orders/${randomUUID()}`]) {
        const open = await ctx.app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${gatedToken}` },
        });
        expect(open.statusCode, url).not.toBe(403);
      }

      await command(gatedToken, "disable-module", { moduleCode: "MAINTENANCE" });

      for (const url of ["/v1/work-orders", "/v1/issues", `/v1/work-orders/${randomUUID()}`]) {
        const response = await ctx.app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${gatedToken}` },
        });
        expect(response.statusCode, url).toBe(403);
        expect(response.json(), url).toEqual({
          error: { code: "MODULE_DISABLED", metadata: { module: "MAINTENANCE" } },
        });
      }
    });
  });
});
