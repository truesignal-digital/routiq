import { randomUUID } from "node:crypto";
import {
  vehicleHistoryResponse,
  type VehicleHistoryItem,
  type VehicleHistoryKind,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, branches, commands, principals, sourceArtifacts } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * The vehicle timeline (PLAN §1.5): one event of each source under its kind,
 * a keyset that survives a command's events sharing one timestamp, and the
 * same branch, module and role rules the record history applies.
 */
describe("GET /v1/assets/:assetId/history", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let admin: Actor;
  let manager: Actor;
  let mechanic: Actor;
  let driver: Actor;
  let dlaOnly: Actor;
  let ydeOnly: Actor;
  let outsider: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    admin = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR", displayName: "Émilienne" });
    manager = await seedActor(ctx.db, { workspaceId, role: "ADMIN", displayName: "Boris" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN", displayName: "Hervé" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER", displayName: "Sali" });
    dlaOnly = await seedActor(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [seeded.branch.id],
    });
    ydeOnly = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [yaounde!.id] });
    const other = await seedWorkspace(ctx.db);
    outsider = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function history(token: string, assetId: string, query = "") {
    const response = await api.get(token, `/v1/assets/${assetId}/history${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return vehicleHistoryResponse.parse(response.body);
  }

  async function all(token: string, assetId: string, query = ""): Promise<VehicleHistoryItem[]> {
    return (await history(token, assetId, `?limit=100${query}`)).items;
  }

  const ofType = (items: VehicleHistoryItem[], eventType: string) =>
    items.filter((item) => item.eventType === eventType);

  async function activity(assetId: string, extra: Record<string, unknown> = {}) {
    const activityId = randomUUID();
    await api.ok(admin.token, "create-activity", {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: assetId,
      startedAt: "2026-08-01T05:00:00Z",
      ...extra,
    });
    const detail = await api.get(admin.token, `/v1/activities/${activityId}`);
    return { activityId, activityNumber: (detail.body as { activityNumber: string }).activityNumber };
  }

  it("files the vehicle's own events as lifecycle and assignments", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    await api.ok(admin.token, "commission-asset", { assetId: truck }, { expectedVersion: 1 });
    await api.ok(
      admin.token,
      "assign-asset",
      { assetId: truck, custodianMembershipId: driver.membershipId },
      { expectedVersion: 2 },
    );

    const lifecycle = await all(admin.token, truck, "&kind=LIFECYCLE");
    expect(lifecycle.map((item) => item.eventType)).toEqual(["asset.commissioned", "asset.registered"]);
    expect(lifecycle[0]).toMatchObject({
      kind: "LIFECYCLE",
      subject: { entityType: "asset", id: truck, number: null },
      actor: { principalId: admin.principalId, displayName: "Émilienne", scope: "WORKSPACE" },
      origin: "HUMAN_UI",
      amountMinor: null,
      currency: null,
      params: {},
    });

    const assignments = await all(admin.token, truck, "&kind=ASSIGNMENTS");
    expect(assignments).toEqual([
      expect.objectContaining({
        eventType: "asset.assigned",
        kind: "ASSIGNMENTS",
        params: {
          custodianDisplayName: "Sali",
          previousCustodianDisplayName: null,
          branchCode: "DLA",
          previousBranchCode: "DLA",
        },
      }),
    ]);
  });

  it("files a trip and its legs under TRIPS, numbered by the activity", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const { activityId, activityNumber } = await activity(truck, { customerName: "Cimencam" });
    await api.ok(admin.token, "record-movement-leg", {
      legId: randomUUID(),
      activityId,
      legNo: 1,
      origin: { kind: "place", placeId: randomUUID(), name: "Douala" },
      destination: { kind: "text", text: "Edéa" },
      distanceKm: 62,
    });

    const trips = await all(admin.token, truck, "&kind=TRIPS");
    expect(ofType(trips, "activity.created")).toEqual([
      expect.objectContaining({
        kind: "TRIPS",
        subject: { entityType: "activity", id: activityId, number: activityNumber },
        params: { activityNumber, customerName: "Cimencam" },
      }),
    ]);
    expect(ofType(trips, "movement_leg.recorded")).toEqual([
      expect.objectContaining({
        kind: "TRIPS",
        subject: expect.objectContaining({ entityType: "movement_leg", number: activityNumber }),
        params: { originName: "Douala", destinationName: "Edéa", distanceKm: 62 },
      }),
    ]);
  });

  it("files a reading under READINGS", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const readingId = randomUUID();
    await api.ok(driver.token, "record-meter-reading", {
      readingId,
      assetId: truck,
      readingType: "ODOMETER",
      value: 123_456,
      observedAt: "2026-08-02T07:00:00Z",
    });
    expect(await all(admin.token, truck, "&kind=READINGS")).toEqual([
      expect.objectContaining({
        eventType: "meter_reading.recorded",
        subject: { entityType: "meter_reading", id: readingId, number: null },
        params: { readingType: "ODOMETER", value: 123_456, source: "MANUAL" },
        actor: expect.objectContaining({ displayName: "Sali" }),
      }),
    ]);
  });

  it("files a document under DOCUMENTS with its type and expiry", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const documentId = randomUUID();
    await api.ok(admin.token, "add-or-renew-document", {
      documentId,
      assetId: truck,
      documentTypeCode: "INSURANCE",
      documentNumber: "POL-2026-118",
      expiresAt: "2027-01-31",
    });
    expect(await all(admin.token, truck, "&kind=DOCUMENTS")).toEqual([
      expect.objectContaining({
        eventType: "document.added",
        subject: { entityType: "document", id: documentId, number: "POL-2026-118" },
        params: {
          documentTypeLabelFr: "Assurance",
          documentTypeLabelEn: "Insurance",
          documentNumber: "POL-2026-118",
          expiresAt: "2027-01-31",
        },
      }),
    ]);
  });

  it("files money with this vehicle's signed share, reversals included", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const otherTruck = await seedAsset(ctx.app, admin.token);
    const entryId = randomUUID();
    const recorded = await api.ok(admin.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-05",
      amountMinor: 100_000,
      paymentMethod: "CASH",
      postings: [
        { assetId: truck, amountMinor: 60_000 },
        { assetId: otherTruck, amountMinor: 40_000 },
      ],
    });
    const file = randomUUID();
    await ctx.db.insert(sourceArtifacts).values({
      id: file,
      workspaceId,
      storageKey: `ws/${workspaceId}/finalized-artifacts/${file}/x`,
      sha256: "x",
      mimeType: "image/jpeg",
      sizeBytes: 1n,
      uploadedByPrincipalId: admin.principalId,
    });
    await api.ok(
      admin.token,
      "attach-evidence",
      { entryId, artifactIds: [file] },
      { sourceArtifactIds: [file] },
    );
    const reversalEntryId = randomUUID();
    await api.ok(
      admin.token,
      "reverse-entry",
      { reversalEntryId, originalEntryId: entryId, reason: "Mauvais camion" },
      { expectedVersion: recorded.rowVersion },
    );

    const money = await all(admin.token, truck, "&kind=MONEY");
    const posted = ofType(money, "financial_entry.posted")[0]!;
    expect(posted).toMatchObject({
      kind: "MONEY",
      subject: { entityType: "financial_entry", id: entryId },
      amountMinor: 60_000,
      currency: "XAF",
      params: {
        direction: "EXPENSE",
        categoryLabelFr: "Carburant",
        categoryLabelEn: "Fuel",
        status: "REVERSED",
      },
    });
    expect(posted.subject.number).toBe(posted.params["entryNumber"]);
    expect(ofType(money, "financial_entry.evidence_attached")[0]).toMatchObject({
      amountMinor: 60_000,
      params: { artifactCount: 1 },
    });
    // Both lines of the correction: the original's reversal event carries its
    // share, the negative entry its own, so the pair nets to zero.
    const reversed = ofType(money, "financial_entry.reversed")[0]!;
    const reversal = money.find((item) => item.subject.id === reversalEntryId)!;
    expect(reversed.amountMinor).toBe(60_000);
    expect(reversal).toMatchObject({
      eventType: "financial_entry.reversal_posted",
      amountMinor: -60_000,
      params: { status: "POSTED" },
      note: "Mauvais camion",
    });
  });

  it("files maintenance under MAINTENANCE, the grounding included", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const issueId = randomUUID();
    await api.ok(driver.token, "report-issue", {
      issueId,
      assetId: truck,
      description: "Direction qui tire à gauche",
      safetyCritical: true,
    });
    const workOrderId = randomUUID();
    await api.ok(mechanic.token, "create-work-order", {
      workOrderId,
      assetId: truck,
      issueId,
      description: "Géométrie du train avant",
      expectedCostMinor: 0,
    });

    const maintenance = await all(admin.token, truck, "&kind=MAINTENANCE");
    expect(ofType(maintenance, "operational_issue.reported")[0]).toMatchObject({
      subject: { entityType: "operational_issue", id: issueId },
      params: { description: "Direction qui tire à gauche", safetyCritical: true },
    });
    expect(ofType(maintenance, "asset_availability.opened")[0]).toMatchObject({
      subject: { entityType: "asset_availability_interval" },
      params: { issueDescription: "Direction qui tire à gauche" },
    });
    expect(ofType(maintenance, "work_order.created")[0]).toMatchObject({
      subject: { entityType: "work_order", id: workOrderId, number: null },
      params: { description: "Géométrie du train avant" },
    });
  });

  it("files a note under NOTES", async () => {
    const truck = await seedAsset(ctx.app, admin.token);
    const noteId = randomUUID();
    await api.ok(manager.token, "add-note", {
      noteId,
      entityType: "asset",
      entityId: truck,
      body: "Garé au dépôt de Bonabéri",
    });
    expect(await all(admin.token, truck, "&kind=NOTES")).toEqual([
      expect.objectContaining({
        eventType: "note.added",
        kind: "NOTES",
        subject: { entityType: "note", id: noteId, number: null },
        params: { body: "Garé au dépôt de Bonabéri" },
        actor: expect.objectContaining({ displayName: "Boris" }),
      }),
    ]);
  });

  describe("paging", () => {
    let truck: string;
    let sheetCommandIds: Set<string>;

    beforeAll(async () => {
      truck = await seedAsset(ctx.app, admin.token);
      await api.ok(admin.token, "add-note", {
        noteId: randomUUID(),
        entityType: "asset",
        entityId: truck,
        body: "Avant la feuille",
      });
      // One waybill, three events sharing a transaction timestamp: the sheet on
      // the activity and one posting event per entry charged to the truck.
      const sheet = await api.ok(admin.token, "record-haulage-job-sheet", {
        activityId: randomUUID(),
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        primarySegmentId: randomUUID(),
        primaryAssetId: truck,
        startedAt: "2026-08-10T05:00:00Z",
        endedAt: "2026-08-10T18:00:00Z",
        entries: [
          {
            entryId: randomUUID(),
            direction: "EXPENSE",
            categoryCode: "FUEL",
            amountMinor: 40_000,
            economicDate: "2026-08-10",
            assetId: truck,
          },
          {
            entryId: randomUUID(),
            direction: "EXPENSE",
            categoryCode: "TOLLS",
            amountMinor: 3_000,
            economicDate: "2026-08-10",
            assetId: truck,
          },
        ],
      });
      sheetCommandIds = new Set([sheet.commandId]);
      await api.ok(admin.token, "add-note", {
        noteId: randomUUID(),
        entityType: "asset",
        entityId: truck,
        body: "Après la feuille",
      });
    });

    it("keeps a command's events together in time and walks them page by page without gaps", async () => {
      const everything = await all(admin.token, truck);
      const sheetEvents = everything.filter((item) =>
        ["activity.sheet_recorded", "financial_entry.posted"].includes(item.eventType),
      );
      expect(sheetEvents).toHaveLength(3);
      expect(new Set(sheetEvents.map((item) => item.occurredAt)).size).toBe(1);
      expect(sheetCommandIds.size).toBe(1);

      for (const limit of [1, 2]) {
        const walked: VehicleHistoryItem[] = [];
        let cursor: string | null = null;
        do {
          const query: string = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const page = await history(admin.token, truck, query);
          expect(page.items.length).toBeLessThanOrEqual(limit);
          walked.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor !== null);
        expect(walked.map((item) => item.eventId), `limit ${limit}`).toEqual(
          everything.map((item) => item.eventId),
        );
      }
      expect(everything.map((item) => item.occurredAt)).toEqual(
        [...everything.map((item) => item.occurredAt)].sort().reverse(),
      );
    });

    it("filters by one kind or several", async () => {
      const money = await all(admin.token, truck, "&kind=MONEY");
      expect(money).toHaveLength(2);
      expect(new Set(money.map((item) => item.kind))).toEqual(new Set(["MONEY"]));

      const mixed = await all(admin.token, truck, "&kind=NOTES&kind=TRIPS");
      expect(new Set(mixed.map((item) => item.kind))).toEqual(new Set(["NOTES", "TRIPS"]));
      expect(mixed).toHaveLength(3);
    });

    it("refuses a malformed cursor or an unknown kind", async () => {
      for (const query of ["?cursor=garbage", "?kind=FUEL"]) {
        const response = await api.get(admin.token, `/v1/assets/${truck}/history${query}`);
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
      }
    });
  });

  describe("scope", () => {
    let truck: string;
    let ydeEntryId: string;
    let ydeActivityId: string;

    beforeAll(async () => {
      truck = await seedAsset(ctx.app, admin.token);
      await api.ok(admin.token, "add-note", {
        noteId: randomUUID(),
        entityType: "asset",
        entityId: truck,
        body: "Note Douala",
      });
      await api.ok(admin.token, "record-expense", {
        entryId: randomUUID(),
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: "2026-08-06",
        amountMinor: 10_000,
        paymentMethod: "CASH",
        postings: [{ assetId: truck, amountMinor: 10_000 }],
      });
      // Recorded under Yaoundé, charged to the Douala truck.
      ydeEntryId = randomUUID();
      await api.ok(admin.token, "record-expense", {
        entryId: ydeEntryId,
        branchCode: "YDE",
        categoryCode: "FUEL",
        economicDate: "2026-08-06",
        amountMinor: 20_000,
        paymentMethod: "CASH",
        postings: [{ assetId: truck, amountMinor: 20_000 }],
      });
      ydeActivityId = randomUUID();
      await api.ok(admin.token, "create-activity", {
        activityId: ydeActivityId,
        branchCode: "YDE",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: truck,
        startedAt: "2026-08-07T05:00:00Z",
      });
      await api.ok(driver.token, "report-issue", {
        issueId: randomUUID(),
        assetId: truck,
        description: "Phare cassé",
        safetyCritical: false,
      });
    });

    it("shows a branch reader only the records of their branches", async () => {
      const seen = await all(dlaOnly.token, truck);
      const ids = seen.map((item) => item.subject.id);
      expect(ids).not.toContain(ydeEntryId);
      expect(ids).not.toContain(ydeActivityId);
      expect(seen.filter((item) => item.kind === "MONEY")).toHaveLength(1);

      const everything = await all(admin.token, truck);
      expect(everything.map((item) => item.subject.id)).toEqual(
        expect.arrayContaining([ydeEntryId, ydeActivityId]),
      );
    });

    it("answers 404 outside the caller's branches or workspace", async () => {
      for (const actor of [ydeOnly, outsider]) {
        const response = await api.get(actor.token, `/v1/assets/${truck}/history`);
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
      }
    });

    it("shows the workshop no money, even when asked for it", async () => {
      const seen = await all(mechanic.token, truck);
      expect(seen.some((item) => item.kind === "MONEY")).toBe(false);
      expect(seen.some((item) => item.kind === "MAINTENANCE")).toBe(true);
      expect(await all(mechanic.token, truck, "&kind=MONEY")).toEqual([]);
    });

    it("lists only events whose record history the same reader may open", async () => {
      for (const actor of [dlaOnly, admin, mechanic]) {
        for (const item of await all(actor.token, truck)) {
          const record = await api.get(
            actor.token,
            `/v1/history/${item.subject.entityType}/${item.subject.id}`,
          );
          expect(record.status, `${item.subject.entityType} for ${actor.displayName}`).toBe(200);
        }
      }
    });

    it("masks a PLATFORM actor as the record history does", async () => {
      const [operator] = await ctx.db
        .insert(principals)
        .values({ principalType: "VENDOR_OPERATOR", displayName: "ROUTIQ support" })
        .returning();
      const commandId = randomUUID();
      await ctx.db.insert(commands).values({
        id: commandId,
        workspaceId,
        scope: "PLATFORM",
        commandType: "import-fleet",
        origin: "API",
        status: "EXECUTED",
        initiatedByPrincipalId: operator!.id,
        idempotencyKey: `platform-${randomUUID()}`,
        payload: {},
      });
      await ctx.db.insert(auditEvents).values({
        workspaceId,
        scope: "PLATFORM",
        commandId,
        eventType: "asset.imported",
        actorPrincipalId: operator!.id,
        entityType: "asset",
        entityId: truck,
      });
      const imported = (await all(admin.token, truck)).find((item) => item.eventType === "asset.imported");
      expect(imported).toMatchObject({
        kind: "LIFECYCLE",
        actor: { principalId: null, displayName: null, scope: "PLATFORM" },
        origin: "API",
      });
    });
  });

  it("drops the sources of disabled modules", async () => {
    const gated = await seedWorkspace(ctx.db);
    const gatedAdmin = await seedActor(ctx.db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
    const truck = await seedAsset(ctx.app, gatedAdmin.token);
    await api.ok(gatedAdmin.token, "report-issue", {
      issueId: randomUUID(),
      assetId: truck,
      description: "Pneu",
      safetyCritical: false,
    });
    await api.ok(gatedAdmin.token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-06",
      amountMinor: 10_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor: 10_000 }],
    });
    const kinds = async () =>
      new Set((await all(gatedAdmin.token, truck)).map((item) => item.kind as VehicleHistoryKind));
    expect(await kinds()).toEqual(new Set(["LIFECYCLE", "MAINTENANCE", "MONEY"]));

    await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "FINANCE" });
    await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "MAINTENANCE" });
    expect(await kinds()).toEqual(new Set(["LIFECYCLE"]));

    await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "ASSETS" });
    const refused = await api.get(gatedAdmin.token, `/v1/assets/${truck}/history`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: { code: "MODULE_DISABLED", metadata: { module: "ASSETS" } } });
  });
});
