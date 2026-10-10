import { randomUUID } from "node:crypto";
import {
  assetAttentionResponse,
  type AssetAttentionItem,
  type AttentionCode,
} from "@routiq/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  activities,
  approvalRules,
  assetAvailabilityIntervals,
  branches,
  sourceArtifacts,
  workspaces,
} from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * Attention (PLAN §1.4): each fact appears on the command that creates it and
 * leaves on the command that settles it, with the makers who may not settle it.
 */
describe("GET /v1/assets/:assetId/attention", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let admin: Actor;
  let manager: Actor;
  let mechanic: Actor;
  let driver: Actor;
  let approver: Actor;
  let dlaReader: Actor;
  let ydeOnly: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    manager = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN", displayName: "Hervé" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER", displayName: "Sali" });
    approver = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    dlaReader = await seedActor(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [seeded.branch.id],
    });
    ydeOnly = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [yaounde!.id] });

    // Work orders above 100 000 need an admin's authorization and sign-off, so
    // the two pending states can be reached.
    await ctx.db.insert(approvalRules).values(
      ["create-work-order", "complete-work-order"].map((commandType) => ({
        workspaceId,
        commandType,
        amountMinMinor: 100_000n,
        requiredRole: "ADMIN" as const,
      })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function attention(token: string, assetId: string) {
    const response = await api.get(token, `/v1/assets/${assetId}/attention`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return assetAttentionResponse.parse(response.body);
  }

  const codes = (items: AssetAttentionItem[]) => items.map((item) => item.code);
  const find = (items: AssetAttentionItem[], code: AttentionCode) =>
    items.find((item) => item.code === code);

  it("walks a grounding from report to release, one fact at a time", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const issueId = randomUUID();
    await api.ok(driver.token, "report-issue", {
      issueId,
      assetId: truck,
      description: "Freins qui grincent fortement à l'arrêt",
      safetyCritical: true,
      category: "BRAKES",
    });

    let body = await attention(manager.token, truck);
    expect(body.items).toEqual([
      expect.objectContaining({
        code: "ISSUE_UNPLANNED",
        severity: "CRITICAL",
        subject: { entityType: "operational_issue", id: issueId, number: null, rowVersion: 1 },
        partOfGrounding: true,
        makerPrincipalIds: [],
        params: {
          description: "Freins qui grincent fortement à l'arrêt",
          safetyCritical: true,
          hasCompletedWorkOrder: false,
          categoryLabelFr: "Freins",
          categoryLabelEn: "Brakes",
        },
      }),
    ]);

    // Above the band: the workshop's order waits for an admin, and its maker
    // may not authorize it.
    const workOrderId = randomUUID();
    const created = await api.ok(mechanic.token, "create-work-order", {
      workOrderId,
      assetId: truck,
      issueId,
      description: "Remplacer disques et plaquettes",
      expectedCostMinor: 250_000,
    });
    body = await attention(manager.token, truck);
    expect(codes(body.items)).toEqual(["WORK_ORDER_AWAITING_AUTHORIZATION"]);
    expect(body.items[0]).toMatchObject({
      severity: "WARNING",
      subject: { entityType: "work_order", id: workOrderId, rowVersion: created.rowVersion },
      partOfGrounding: true,
      makerPrincipalIds: [mechanic.principalId],
      params: { expectedCostMinor: 250_000, currency: "XAF" },
    });

    const approved = await api.ok(
      admin.token,
      "approve-work-order",
      { workOrderId },
      { expectedVersion: created.rowVersion },
    );
    body = await attention(manager.token, truck);
    expect(codes(body.items)).toEqual(["WORK_ORDER_IN_PROGRESS"]);
    expect(body.items[0]).toMatchObject({ severity: "INFO", makerPrincipalIds: [] });

    const completed = await api.ok(
      mechanic.token,
      "complete-work-order",
      { workOrderId, actualCostMinor: 240_000, summary: "Disques neufs" },
      { expectedVersion: approved.rowVersion },
    );
    body = await attention(manager.token, truck);
    expect(codes(body.items)).toEqual(["WORK_ORDER_AWAITING_SIGN_OFF"]);
    expect(body.items[0]).toMatchObject({
      makerPrincipalIds: [mechanic.principalId],
      // A v1 close's typed amount is a declaration, not cost (#81): the actual
      // cost is what the books hold against the order, and here they hold none.
      params: { actualCostMinor: 0 },
    });

    // Sent back: in progress again, flagged with why.
    const sentBack = await api.ok(
      admin.token,
      "reject-work-order-completion",
      { workOrderId, reason: "Photo de la facture manquante" },
      { expectedVersion: completed.rowVersion },
    );
    body = await attention(manager.token, truck);
    expect(body.items[0]).toMatchObject({
      code: "WORK_ORDER_IN_PROGRESS",
      severity: "WARNING",
      params: { completionRejectReason: "Photo de la facture manquante" },
    });

    const resubmitted = await api.ok(
      mechanic.token,
      "complete-work-order",
      { workOrderId, actualCostMinor: 240_000, summary: "Facture jointe" },
      { expectedVersion: sentBack.rowVersion },
    );
    await api.ok(
      admin.token,
      "approve-work-order-closure",
      { workOrderId },
      { expectedVersion: resubmitted.rowVersion },
    );
    body = await attention(manager.token, truck);
    // The v1 close declared 240 000 that the books do not hold: cost to come (#82).
    expect(codes(body.items)).toEqual(["ASSET_AWAITING_RELEASE", "WORK_ORDER_COST_TO_COME"]);
    expect(body.items[1]).toMatchObject({
      subject: { entityType: "work_order", id: workOrderId },
      partOfGrounding: false,
      params: { declaredCostMinor: 240_000, recordedCostMinor: 0 },
    });
    expect(body.items[0]).toMatchObject({
      severity: "CRITICAL",
      subject: { entityType: "asset_availability_interval" },
      partOfGrounding: true,
      // Safety-critical: whoever declared the work complete may not release.
      makerPrincipalIds: [mechanic.principalId],
      params: { overrideRequired: false, hasCompletedWorkOrder: true, safetyCritical: true },
    });

    await api.ok(manager.token, "release-asset-to-service", { assetId: truck, workOrderId });
    // The release settles the grounding, not the money.
    expect(codes((await attention(manager.token, truck)).items)).toEqual(["WORK_ORDER_COST_TO_COME"]);
  });

  it("asks for an override release when the grounding signalement was closed without a work order", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const issueId = randomUUID();
    const reported = await api.ok(driver.token, "report-issue", {
      issueId,
      assetId: truck,
      description: "Voyant ABS",
      safetyCritical: true,
    });
    await api.ok(
      mechanic.token,
      "dismiss-issue",
      { issueId, reason: "Capteur débranché" },
      { expectedVersion: reported.rowVersion },
    );
    const body = await attention(manager.token, truck);
    expect(codes(body.items)).toEqual(["ASSET_AWAITING_RELEASE"]);
    expect(body.items[0]).toMatchObject({
      makerPrincipalIds: [mechanic.principalId],
      params: { overrideRequired: true, hasCompletedWorkOrder: false },
    });
  });

  it("offers no release while another safety-critical signalement is open", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const brakes = randomUUID();
    await api.ok(driver.token, "report-issue", {
      issueId: brakes,
      assetId: truck,
      description: "Freins",
      safetyCritical: true,
    });
    const steering = randomUUID();
    const steeringReported = await api.ok(driver.token, "report-issue", {
      issueId: steering,
      assetId: truck,
      description: "Direction bloquée",
      safetyCritical: true,
    });
    const workOrderId = randomUUID();
    const created = await api.ok(mechanic.token, "create-work-order", {
      workOrderId,
      assetId: truck,
      issueId: brakes,
      description: "Freins",
      expectedCostMinor: 10_000,
    });
    await api.ok(
      mechanic.token,
      "complete-work-order",
      { workOrderId },
      { expectedVersion: created.rowVersion },
    );

    let body = await attention(manager.token, truck);
    expect(codes(body.items)).toEqual(["ISSUE_UNPLANNED"]);
    expect(body.items[0]).toMatchObject({
      severity: "CRITICAL",
      subject: { id: steering },
      partOfGrounding: false,
    });

    await api.ok(
      mechanic.token,
      "dismiss-issue",
      { issueId: steering, reason: "Doublon du signalement freins" },
      { expectedVersion: steeringReported.rowVersion },
    );
    body = await attention(manager.token, truck);
    expect(codes(body.items)).toEqual(["ASSET_AWAITING_RELEASE"]);
  });

  it("keeps a quiet reminder once a truck is released with its signalement still open", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const issueId = randomUUID();
    await api.ok(driver.token, "report-issue", {
      issueId,
      assetId: truck,
      description: "Freins",
      safetyCritical: true,
    });
    const workOrderId = randomUUID();
    const created = await api.ok(mechanic.token, "create-work-order", {
      workOrderId,
      assetId: truck,
      issueId,
      description: "Plaquettes",
      expectedCostMinor: 10_000,
    });
    await api.ok(
      mechanic.token,
      "complete-work-order",
      { workOrderId, resolveLinkedIssue: false },
      { expectedVersion: created.rowVersion },
    );
    const released = await api.ok(manager.token, "release-asset-to-service", { assetId: truck });
    expect(released.warnings).toEqual(["GROUNDING_ISSUE_STILL_OPEN"]);

    const body = await attention(manager.token, truck);
    expect(body.items).toEqual([
      expect.objectContaining({
        code: "ISSUE_OPEN_WHILE_AVAILABLE",
        severity: "INFO",
        subject: { entityType: "operational_issue", id: issueId, number: null, rowVersion: 1 },
        partOfGrounding: false,
        makerPrincipalIds: [],
        params: { description: "Freins", safetyCritical: true, hasCompletedWorkOrder: true },
      }),
    ]);
    const [interval] = await ctx.db
      .select({ closedAt: assetAvailabilityIntervals.closedAt })
      .from(assetAvailabilityIntervals)
      .where(eq(assetAvailabilityIntervals.assetId, truck));
    expect(body.items[0]?.since).toBe(interval?.closedAt?.toISOString());
  });

  it("warns about a minor fault nobody has planned, outside any grounding", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const issueId = randomUUID();
    await api.ok(driver.token, "report-issue", {
      issueId,
      assetId: truck,
      description: "Rétroviseur fissuré",
      safetyCritical: false,
    });
    expect((await attention(manager.token, truck)).items[0]).toMatchObject({
      code: "ISSUE_UNPLANNED",
      severity: "WARNING",
      partOfGrounding: false,
    });
    await api.ok(mechanic.token, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: truck,
      issueId,
      description: "Changer le rétroviseur",
      expectedCostMinor: 0,
    });
    expect(codes((await attention(manager.token, truck)).items)).toEqual(["WORK_ORDER_IN_PROGRESS"]);
  });

  it("judges document expiry by the workspace's business date, not the server clock", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const addDocument = (typeCode: string, expiresAt: string) =>
      api.ok(admin.token, "add-or-renew-document", {
        documentId: randomUUID(),
        assetId: truck,
        documentTypeCode: typeCode,
        documentNumber: `${typeCode}-${expiresAt}`,
        expiresAt,
      });
    await addDocument("INSURANCE", "2026-08-31");
    await addDocument("PERMIT", "2026-10-01");

    // 23:30 UTC on 31 August is already 1 September in Douala (UTC+1).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T23:30:00Z"));
    const body = await attention(manager.token, truck);
    vi.useRealTimers();

    expect(body.businessDate).toBe("2026-09-01");
    expect(body.items).toEqual([
      expect.objectContaining({
        code: "DOCUMENT_EXPIRED",
        severity: "CRITICAL",
        subject: {
          entityType: "document",
          id: expect.any(String),
          number: "INSURANCE-2026-08-31",
          rowVersion: null,
        },
        params: {
          documentTypeLabelFr: "Assurance",
          documentTypeLabelEn: "Insurance",
          expiresAt: "2026-08-31",
          daysLeft: -1,
        },
      }),
      // 30 days ahead, the permit's last day is inside the window.
      expect.objectContaining({
        code: "DOCUMENT_EXPIRING",
        severity: "WARNING",
        params: expect.objectContaining({ expiresAt: "2026-10-01", daysLeft: 30 }),
      }),
    ]);
  });

  it.each([
    { timezone: "Pacific/Kiritimati", offsetHours: 14 },
    { timezone: "Pacific/Pago_Pago", offsetHours: -11 },
  ])(
    "dates a document's attention from the workspace's midnight in $timezone",
    async ({ timezone, offsetHours }) => {
      const zoned = await seedWorkspace(ctx.db);
      await ctx.db
        .update(workspaces)
        .set({ timezone })
        .where(eq(workspaces.id, zoned.workspace.id));
      const zonedAdmin = await seedActor(ctx.db, { workspaceId: zoned.workspace.id, role: "ADMIN" });
      const truck = await seedAsset(ctx.app, zonedAdmin.token);
      for (const [typeCode, expiresAt] of [
        ["INSURANCE", "2026-08-31"],
        ["PERMIT", "2026-10-01"],
      ] as const) {
        await api.ok(zonedAdmin.token, "add-or-renew-document", {
          documentId: randomUUID(),
          assetId: truck,
          documentTypeCode: typeCode,
          expiresAt,
        });
      }

      // Midday on 1 September wherever the workspace is.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 12) - offsetHours * 3_600_000));
      const body = await attention(zonedAdmin.token, truck);
      vi.useRealTimers();

      const localMidnight = (date: string) =>
        new Date(Date.parse(`${date}T00:00:00Z`) - offsetHours * 3_600_000).toISOString();
      expect(body.businessDate).toBe("2026-09-01");
      expect(body.items.map(({ code, since }) => ({ code, since }))).toEqual([
        // Expired since the day it expired began.
        { code: "DOCUMENT_EXPIRED", since: localMidnight("2026-08-31") },
        // Expiring since 30 days before its last day.
        { code: "DOCUMENT_EXPIRING", since: localMidnight("2026-09-01") },
      ]);
    },
  );

  it("drops a renewed document", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const original = randomUUID();
    await api.ok(admin.token, "add-or-renew-document", {
      documentId: original,
      assetId: truck,
      documentTypeCode: "INSURANCE",
      expiresAt: "2020-01-01",
    });
    expect(codes((await attention(manager.token, truck)).items)).toEqual(["DOCUMENT_EXPIRED"]);
    await api.ok(admin.token, "add-or-renew-document", {
      documentId: randomUUID(),
      assetId: truck,
      documentTypeCode: "INSURANCE",
      expiresAt: "2099-01-01",
      supersedesDocumentId: original,
    });
    expect((await attention(manager.token, truck)).items).toEqual([]);
  });

  it("raises entries for review and missing paperwork, settled by approval and a receipt", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const entryId = randomUUID();
    const recorded = await api.ok(driver.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-09-02",
      amountMinor: 180_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor: 180_000 }],
    });
    let body = await attention(manager.token, truck);
    expect(codes(body.items).sort()).toEqual(["ENTRY_AWAITING_REVIEW", "ENTRY_EVIDENCE_MISSING"]);
    expect(find(body.items, "ENTRY_AWAITING_REVIEW")).toMatchObject({
      severity: "INFO",
      subject: { entityType: "financial_entry", id: entryId, rowVersion: 1 },
      makerPrincipalIds: [driver.principalId],
      params: {
        amountMinor: 180_000,
        currency: "XAF",
        recordedBy: { principalId: driver.principalId, displayName: "Sali", scope: "WORKSPACE" },
        categoryLabelFr: "Carburant",
      },
    });

    await api.ok(
      approver.token,
      "approve-entry",
      { entryId },
      { expectedVersion: recorded.rowVersion },
    );
    body = await attention(manager.token, truck);
    // Posted in an open month: the receipt can still be added.
    expect(codes(body.items)).toEqual(["ENTRY_EVIDENCE_MISSING"]);

    const file = randomUUID();
    await ctx.db.insert(sourceArtifacts).values({
      id: file,
      workspaceId,
      storageKey: `ws/${workspaceId}/finalized-artifacts/${file}/x`,
      sha256: "x",
      mimeType: "image/jpeg",
      sizeBytes: 1n,
      uploadedByPrincipalId: driver.principalId,
    });
    await api.ok(
      driver.token,
      "attach-evidence",
      { entryId, artifactIds: [file] },
      { sourceArtifactIds: [file] },
    );
    expect((await attention(manager.token, truck)).items).toEqual([]);
  });

  it("shows no ledger facts to the workshop, and no other branch's entries to a branch reader", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    await api.ok(admin.token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "YDE",
      categoryCode: "FUEL",
      economicDate: "2026-09-03",
      amountMinor: 20_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor: 20_000 }],
    });
    expect(codes((await attention(admin.token, truck)).items)).toEqual(["ENTRY_EVIDENCE_MISSING"]);
    expect((await attention(dlaReader.token, truck)).items).toEqual([]);
    expect((await attention(mechanic.token, truck)).items).toEqual([]);
  });

  it("leaves out the sources of disabled modules", async () => {
    const gated = await seedWorkspace(ctx.db);
    const gatedAdmin = await seedActor(ctx.db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
    const truck = await seedAsset(ctx.app, gatedAdmin.token);
    await api.ok(gatedAdmin.token, "report-issue", {
      issueId: randomUUID(),
      assetId: truck,
      description: "Pneu crevé",
      safetyCritical: false,
    });
    await api.ok(gatedAdmin.token, "add-or-renew-document", {
      documentId: randomUUID(),
      assetId: truck,
      documentTypeCode: "INSURANCE",
      expiresAt: "2020-01-01",
    });
    expect(codes((await attention(gatedAdmin.token, truck)).items).sort()).toEqual([
      "DOCUMENT_EXPIRED",
      "ISSUE_UNPLANNED",
    ]);
    await setModule(ctx.db, gated.workspace.id, "MAINTENANCE", false);
    await setModule(ctx.db, gated.workspace.id, "DOCUMENTS", false);
    expect((await attention(gatedAdmin.token, truck)).items).toEqual([]);

    await setModule(ctx.db, gated.workspace.id, "ASSETS", false);
    const refused = await api.get(gatedAdmin.token, `/v1/assets/${truck}/attention`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: { code: "MODULE_DISABLED", metadata: { module: "ASSETS" } } });
  });

  // #577: a vehicle on two unfinished trips flags both, each naming the other,
  // until someone closes the stale one.
  it("flags both trips while a vehicle is on two unfinished trips", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const startTrip = async (minutesAgo: number) => {
      const activityId = randomUUID();
      await api.ok(admin.token, "create-activity", {
        activityId,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: truck,
        startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      });
      const [row] = await ctx.db
        .select({ activityNumber: activities.activityNumber, startedAt: activities.startedAt })
        .from(activities)
        .where(eq(activities.id, activityId));
      return { id: activityId, number: row!.activityNumber, startedAt: row!.startedAt! };
    };
    const stale = await startTrip(600);
    expect(codes((await attention(manager.token, truck)).items)).toEqual([]);
    const current = await startTrip(30);

    const items = (await attention(manager.token, truck)).items.filter(
      (item) => item.code === "VEHICLE_DOUBLE_BOOKED",
    );
    // Since the second start: that is when the vehicle came to be on both.
    const since = current.startedAt.toISOString();
    // Same severity and since: the read orders the pair by subject id.
    items.sort((left, right) => (left.subject.id === stale.id ? -1 : right.subject.id === stale.id ? 1 : 0));
    expect(items).toEqual([
      {
        code: "VEHICLE_DOUBLE_BOOKED",
        severity: "WARNING",
        subject: { entityType: "activity", id: stale.id, number: stale.number, rowVersion: 1 },
        since,
        partOfGrounding: false,
        makerPrincipalIds: [],
        params: { tripNumbers: [current.number] },
      },
      {
        code: "VEHICLE_DOUBLE_BOOKED",
        severity: "WARNING",
        subject: { entityType: "activity", id: current.id, number: current.number, rowVersion: 1 },
        since,
        partOfGrounding: false,
        makerPrincipalIds: [],
        params: { tripNumbers: [stale.number] },
      },
    ]);

    // A driver reads only their own trips, and is on neither.
    expect(codes((await attention(driver.token, truck)).items)).not.toContain("VEHICLE_DOUBLE_BOOKED");

    await api.ok(
      admin.token,
      "close-activity",
      { activityId: stale.id, endedAt: new Date(Date.now() - 300 * 60_000).toISOString() },
      { expectedVersion: 1 },
    );
    expect(codes((await attention(manager.token, truck)).items)).toEqual([]);
  });

  it("flags both trips when the second start is stamped ahead of the server clock", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    for (const minutesAgo of [60, -2]) {
      await api.ok(admin.token, "create-activity", {
        activityId: randomUUID(),
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: truck,
        startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      });
    }
    expect(codes((await attention(manager.token, truck)).items)).toEqual([
      "VEHICLE_DOUBLE_BOOKED",
      "VEHICLE_DOUBLE_BOOKED",
    ]);
  });

  it("leaves the trip flag out while Activities is off", async () => {
    const gated = await seedWorkspace(ctx.db);
    const director = await seedActor(ctx.db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
    const truck = await seedAsset(ctx.app, director.token);
    for (const minutesAgo of [300, 20]) {
      await api.ok(director.token, "create-activity", {
        activityId: randomUUID(),
        branchCode: gated.branch.code,
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: truck,
        startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      });
    }
    expect(codes((await attention(director.token, truck)).items)).toEqual([
      "VEHICLE_DOUBLE_BOOKED",
      "VEHICLE_DOUBLE_BOOKED",
    ]);
    await setModule(ctx.db, gated.workspace.id, "ACTIVITIES", false);
    expect((await attention(director.token, truck)).items).toEqual([]);
  });

  it("answers 404 outside the caller's branches", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const response = await api.get(ydeOnly.token, `/v1/assets/${truck}/attention`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
  });

  it("orders by severity, then oldest first", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    await api.ok(driver.token, "report-issue", {
      issueId: randomUUID(),
      assetId: truck,
      description: "Essuie-glace",
      safetyCritical: false,
    });
    await api.ok(driver.token, "report-issue", {
      issueId: randomUUID(),
      assetId: truck,
      description: "Direction dure",
      safetyCritical: true,
    });
    const body = await attention(manager.token, truck);
    expect(body.items.map((item) => item.severity)).toEqual(["CRITICAL", "WARNING"]);
  });

});
