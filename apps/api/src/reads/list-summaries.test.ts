import { randomUUID } from "node:crypto";
import {
  activityListResponse,
  activitySummary,
  issueListResponse,
  maintenanceSummary,
  workOrderListResponse,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";

/**
 * The overview tiles over the Trips and Maintenance lists (#302). Each count is
 * the server's, inside the caller's branch scope, and the tiles that filter
 * count exactly what their filter lists.
 */
describe("list overview summaries", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let doualaId: string;
  let yaoundeId: string;
  let admin: Actor;
  let mechanic: Actor;
  let doualaOnly: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    doualaId = seeded.branch.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");
    yaoundeId = yaounde.id;

    admin = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    doualaOnly = await seedActor(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [doualaId],
    });

    const commission = (assetId: string) =>
      api.ok(admin.token, "commission-asset", { assetId }, { expectedVersion: 1 });
    const dla1 = await seedAsset(ctx.app, admin.token, { assetCode: "VH001" });
    const dla2 = await seedAsset(ctx.app, admin.token, { assetCode: "VH002" });
    const yde1 = await seedAsset(ctx.app, admin.token, {
      assetCode: "VH003",
      branchCode: "YDE",
    });
    for (const id of [dla1, dla2, yde1]) await commission(id);

    // Trips: two this week in Douala (one with legs), one last week in
    // Douala, one this week in Yaoundé.
    const startTrip = async (
      assetId: string,
      branchCode: string,
      startedAt: Date,
      legsKm: number[] = [],
    ) => {
      const activityId = randomUUID();
      const segmentId = randomUUID();
      await api.ok(admin.token, "create-activity", {
        activityId,
        branchCode,
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: segmentId,
        primaryAssetId: assetId,
        startedAt: startedAt.toISOString(),
      });
      for (const [index, km] of legsKm.entries()) {
        await api.ok(admin.token, "record-movement-leg", {
          legId: randomUUID(),
          activityId,
          legNo: index + 1,
          segmentId,
          origin: { kind: "text", text: `Stop ${index}` },
          destination: { kind: "text", text: `Stop ${index + 1}` },
          distanceKm: km,
        });
      }
      return activityId;
    };
    const now = Date.now();
    // Started just now, so the business week holding "now" holds them too.
    await startTrip(dla1, "DLA", new Date(now - 1_000), [68, 116]);
    const incompleteId = await startTrip(dla2, "DLA", new Date(now - 2_000));
    await startTrip(dla1, "DLA", new Date(now - 9 * 86_400_000), [500]);
    await startTrip(yde1, "YDE", new Date(now - 3_000), [40]);
    // Closing with exceptions is the close command's job; the summary only
    // reads the column, so the fixture sets it directly.
    await ctx.db
      .update(activities)
      .set({ status: "CLOSED", completeness: "COMPLETE_WITH_EXCEPTIONS" })
      .where(and(eq(activities.workspaceId, workspaceId), eq(activities.id, incompleteId)));

    // Maintenance: VH002 grounded with a safety-critical issue and an approved
    // work order; VH001 a minor open issue; VH003 grounded in Yaoundé with a
    // completed repair.
    const report = async (assetId: string, safetyCritical: boolean) => {
      const issueId = randomUUID();
      await api.ok(admin.token, "report-issue", {
        issueId,
        assetId,
        description: "Freins",
        safetyCritical,
      });
      return issueId;
    };
    const groundedIssue = await report(dla2, true);
    await report(dla1, false);
    await api.ok(mechanic.token, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: dla2,
      issueId: groundedIssue,
      description: "Remplacer les plaquettes",
      expectedCostMinor: 0,
    });
    const ydeIssue = await report(yde1, true);
    const ydeWorkOrderId = randomUUID();
    const created = await api.ok(mechanic.token, "create-work-order", {
      workOrderId: ydeWorkOrderId,
      assetId: yde1,
      issueId: ydeIssue,
      description: "Réparer",
      expectedCostMinor: 0,
    });
    await api.ok(
      mechanic.token,
      "complete-work-order",
      { workOrderId: ydeWorkOrderId, summary: "Réparé" },
      { expectedVersion: created.rowVersion },
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function tripSummary(token: string, query = "") {
    const response = await api.get(token, `/v1/activities/summary${query}`);
    expect(response.status).toBe(200);
    return activitySummary.parse(response.body);
  }

  async function workshopSummary(token: string, query = "") {
    const response = await api.get(token, `/v1/maintenance/summary${query}`);
    expect(response.status).toBe(200);
    return maintenanceSummary.parse(response.body);
  }

  describe("GET /v1/activities/summary", () => {
    it("counts the seeded workspace", async () => {
      const summary = await tripSummary(admin.token);
      expect(summary).toMatchObject({ thisWeek: 3, open: 3, incomplete: 1, weekKm: 224 });
      expect(summary.week.from <= summary.week.to).toBe(true);
    });

    it("counts what the open and incomplete filters list", async () => {
      const summary = await tripSummary(admin.token);
      const open = await api.get(admin.token, "/v1/activities?status=OPEN");
      const incomplete = await api.get(
        admin.token,
        "/v1/activities?completeness=COMPLETE_WITH_EXCEPTIONS",
      );
      expect(activityListResponse.parse(open.body).items).toHaveLength(summary.open);
      expect(activityListResponse.parse(incomplete.body).items).toHaveLength(
        summary.incomplete,
      );
    });

    it("stays inside the caller's branch scope, and narrows within it", async () => {
      expect(await tripSummary(doualaOnly.token)).toMatchObject({
        thisWeek: 2,
        open: 2,
        incomplete: 1,
        weekKm: 184,
      });
      expect(await tripSummary(admin.token, `?branchId=${yaoundeId}`)).toMatchObject({
        thisWeek: 1,
        open: 1,
        incomplete: 0,
        weekKm: 40,
      });
      // A branch outside the scope narrows to nothing, never widens.
      expect(await tripSummary(doualaOnly.token, `?branchId=${yaoundeId}`)).toMatchObject({
        thisWeek: 0,
        open: 0,
        weekKm: null,
      });
    });

    it("refuses a malformed branch", async () => {
      const response = await api.get(admin.token, "/v1/activities/summary?branchId=nope");
      expect(response.status).toBe(400);
    });

    it("answers MODULE_DISABLED when ACTIVITIES is off", async () => {
      const gated = await seedWorkspace(ctx.db);
      const gatedAdmin = await seedActor(ctx.db, {
        workspaceId: gated.workspace.id,
        role: "DIRECTOR",
      });
      await setModule(ctx.db, gated.workspace.id, "ACTIVITIES", false);
      const response = await api.get(gatedAdmin.token, "/v1/activities/summary");
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: { code: "MODULE_DISABLED", metadata: { module: "ACTIVITIES" } },
      });
    });
  });

  describe("GET /v1/maintenance/summary", () => {
    it("counts the seeded workspace", async () => {
      const summary = await workshopSummary(admin.token);
      expect(summary).toMatchObject({
        openIssues: 2,
        openSafetyCritical: 1,
        approvedWorkOrders: 1,
        repairsCounted: 1,
        repairWindowDays: 90,
      });
      // VH002 is grounded; VH003's completed repair alone does not release it.
      expect(summary.grounded).toBe(2);
      expect(summary.averageRepairDays).not.toBeNull();
    });

    it("counts what the open-issue and approved-order filters list", async () => {
      const summary = await workshopSummary(admin.token);
      const issues = await api.get(admin.token, "/v1/issues?status=OPEN");
      const orders = await api.get(admin.token, "/v1/work-orders?status=APPROVED");
      expect(issueListResponse.parse(issues.body).items).toHaveLength(summary.openIssues);
      expect(workOrderListResponse.parse(orders.body).items).toHaveLength(
        summary.approvedWorkOrders,
      );
    });

    it("stays inside the caller's branch scope, and narrows within it", async () => {
      expect(await workshopSummary(doualaOnly.token)).toMatchObject({
        openIssues: 2,
        grounded: 1,
        approvedWorkOrders: 1,
        repairsCounted: 0,
        averageRepairDays: null,
      });
      expect(await workshopSummary(admin.token, `?branchId=${yaoundeId}`)).toMatchObject({
        openIssues: 0,
        grounded: 1,
        approvedWorkOrders: 0,
        repairsCounted: 1,
      });
      expect(
        await workshopSummary(doualaOnly.token, `?branchId=${yaoundeId}`),
      ).toMatchObject({ openIssues: 0, grounded: 0, approvedWorkOrders: 0, repairsCounted: 0 });
    });

    it("answers MODULE_DISABLED when MAINTENANCE is off", async () => {
      const gated = await seedWorkspace(ctx.db);
      const gatedAdmin = await seedActor(ctx.db, {
        workspaceId: gated.workspace.id,
        role: "DIRECTOR",
      });
      await setModule(ctx.db, gated.workspace.id, "MAINTENANCE", false);
      const response = await api.get(gatedAdmin.token, "/v1/maintenance/summary");
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: { code: "MODULE_DISABLED", metadata: { module: "MAINTENANCE" } },
      });
    });
  });
});
