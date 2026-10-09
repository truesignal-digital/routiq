import { randomUUID } from "node:crypto";
import {
  activityDetail,
  HISTORY_CODE_SETS,
  HISTORY_ENTITY_TYPES,
  HISTORY_STATE_KEYS,
  historyEventDiff,
  historyListResponse,
  type HistoryItem,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { auditEvents, branches, categories, commands, principals } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { diffStates } from "./history.js";

describe("GET /v1/history/:entityType/:entityId", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let otherToken: string;
  let workspaceId: string;
  let adminPrincipalId: string;
  let activityId: string;
  let maintenanceAssetId: string;
  let issueId: string;
  let workOrderId: string;
  let availabilityIntervalId: string;
  let driverId: string;

  async function command(
    name: string,
    payload: Record<string, unknown>,
    options: { token?: string; expectedVersion?: number } = {},
  ) {
    const response = await ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${options.token ?? token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `history-read-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...(options.expectedVersion === undefined
            ? {}
            : { expectedVersion: options.expectedVersion }),
        },
        payload,
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(`${name} failed: ${response.statusCode} ${response.body}`);
    }
    return response.json();
  }

  /** Reopen and close both lock on the activity's version, so read it back first. */
  async function activityRowVersion(): Promise<number> {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/activities/${activityId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return activityDetail.parse(response.json()).rowVersion;
  }

  async function history(
    entityType: string,
    entityId: string,
    query = "",
    authToken = token,
  ) {
    return ctx.app.inject({
      method: "GET",
      url: `/v1/history/${entityType}/${entityId}${query}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();

    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const admin = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminPrincipalId = admin.principal.id;
    token = (
      await createSession(ctx.db, { workspaceId, principalId: adminPrincipalId })
    ).token;

    const otherSeeded = await seedWorkspace(ctx.db);
    const otherAdmin = await seedMember(ctx.db, {
      workspaceId: otherSeeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    otherToken = (
      await createSession(ctx.db, {
        workspaceId: otherSeeded.workspace.id,
        principalId: otherAdmin.principal.id,
      })
    ).token;

    const assetId = await seedAsset(ctx.app, token, { assetCode: "HIST-TRUCK" });
    driverId = randomUUID();
    await command("register-person", {
      personId: driverId,
      displayName: "Abdoulaye Sanda",
      branchCode: "DLA",
      defaultRole: "DRIVER",
    });

    // One activity carrying a chain of events: recorded, reopened (with a
    // motif), closed again — three commands, three audit rows, one entity.
    activityId = randomUUID();
    await command("record-haulage-job-sheet", {
      activityId,
      close: true,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId: assetId,
      startedAt: "2026-07-10T06:10:00Z",
      endedAt: "2026-07-11T09:00:00Z",
      customerName: "Brasseries du Cameroun",
      startReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER",
        value: 410_000,
        observedAt: "2026-07-10T06:10:00Z",
      },
      endReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER",
        value: 411_125,
        observedAt: "2026-07-11T09:00:00Z",
      },
      crew: [
        {
          activityPersonId: randomUUID(),
          personId: driverId,
          role: "DRIVER",
        },
      ],
      legs: [
        {
          legId: randomUUID(),
          legNo: 1,
          origin: { kind: "text", text: "Douala" },
          destination: { kind: "text", text: "Yaoundé" },
          distanceKm: 245,
          loadState: "LADEN",
        },
      ],
    });
    await command(
      "reopen-activity",
      { activityId, reason: "Kilométrage de fin corrigé par le bureau" },
      { expectedVersion: await activityRowVersion() },
    );
    await command(
      "close-activity",
      { activityId },
      { expectedVersion: await activityRowVersion() },
    );

    // A second truck carrying the maintenance chain: a safety-critical
    // signalement grounds it, one work order repairs it, and a release puts it
    // back on the road. Three entity types, three timelines, one story.
    const mechanic = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const mechanicToken = (
      await createSession(ctx.db, {
        workspaceId,
        principalId: mechanic.principal.id,
      })
    ).token;

    maintenanceAssetId = await seedAsset(ctx.app, token, {
      assetCode: "HIST-WO-TRUCK",
    });
    issueId = randomUUID();
    await command("report-issue", {
      issueId,
      assetId: maintenanceAssetId,
      description: "Fuite de liquide de frein",
      safetyCritical: true,
      category: "BRAKES",
    });

    workOrderId = randomUUID();
    const createdWorkOrder = await command("create-work-order", {
      workOrderId,
      assetId: maintenanceAssetId,
      issueId,
      description: "Réfection du circuit de freinage",
      expectedCostMinor: 300_000,
    });
    await command(
      "complete-work-order",
      {
        workOrderId,
        actualCostMinor: 325_000,
        summary: "Maître-cylindre et flexibles remplacés",
      },
      { token: mechanicToken, expectedVersion: createdWorkOrder.rowVersion },
    );
    // Releaser ≠ performer, because the originating signalement is safety-critical.
    const released = await command("release-asset-to-service", {
      assetId: maintenanceAssetId,
      workOrderId,
      note: "Essai routier concluant",
    });
    availabilityIntervalId = released.recordId;
  });

  afterAll(async () => ctx.close());

  it("returns the record's events newest first", async () => {
    const response = await history("activity", activityId);
    expect(response.statusCode).toBe(200);

    const body = historyListResponse.parse(response.json());
    expect(body.items.map((item) => item.eventType)).toEqual([
      "activity.closed",
      "activity.reopened",
      "activity.sheet_recorded",
    ]);
    expect(body.nextCursor).toBeNull();

    const [closed] = body.items;
    expect(closed).toMatchObject({
      actor: {
        principalId: adminPrincipalId,
        scope: "WORKSPACE",
      },
      command: { name: "close-activity", version: "1", origin: "HUMAN_UI" },
    });
    expect(closed?.changedFields).toContain("status");
  });

  it("lifts the reopen motif into `note`, and leaves other events without one", async () => {
    const response = await history("activity", activityId);
    const body = historyListResponse.parse(response.json());

    const reopened = body.items.find(
      (item) => item.eventType === "activity.reopened",
    );
    expect(reopened?.note).toBe("Kilométrage de fin corrigé par le bureau");

    const recorded = body.items.find(
      (item) => item.eventType === "activity.sheet_recorded",
    );
    expect(recorded?.note).toBeNull();
  });

  it("walks the whole timeline through the cursor without skipping or repeating", async () => {
    const seen: HistoryItem[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 5; page += 1) {
      const query: string = cursor
        ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "?limit=1";
      const response = await history("activity", activityId, query);
      expect(response.statusCode).toBe(200);
      const body = historyListResponse.parse(response.json());
      seen.push(...body.items);
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(cursor).toBeNull();
    const eventIds = seen.map((item) => item.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);

    const wholePage = historyListResponse.parse(
      (await history("activity", activityId)).json(),
    );
    expect(eventIds).toEqual(wholePage.items.map((item) => item.eventId));
  });

  it("keeps the walk stable when two events share a timestamp", async () => {
    const [anchor] = await ctx.db
      .select({ commandId: auditEvents.commandId })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, activityId))
      .limit(1);
    if (!anchor) throw new Error("no audit event to borrow a command from");

    const tiedEntityId = randomUUID();
    const occurredAt = new Date("2026-07-12T08:00:00Z");
    await ctx.db.insert(auditEvents).values(
      [1, 2, 3].map(() => ({
        workspaceId,
        commandId: anchor.commandId,
        eventType: "activity.tied",
        actorPrincipalId: adminPrincipalId,
        entityType: "activity",
        entityId: tiedEntityId,
        changedFields: [],
        occurredAt,
      })),
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const query: string = cursor
        ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "?limit=1";
      const body = historyListResponse.parse(
        (await history("activity", tiedEntityId, query)).json(),
      );
      seen.push(...body.items.map((item) => item.eventId));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("renders a PLATFORM event with no principal behind it", async () => {
    const [operator] = await ctx.db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
      .returning();
    if (!operator) throw new Error("operator principal insert returned no row");

    const commandId = randomUUID();
    await ctx.db.insert(commands).values({
      id: commandId,
      workspaceId,
      commandType: "provision-workspace",
      commandVersion: "1",
      scope: "PLATFORM",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: operator.id,
      idempotencyKey: `history-platform-${randomUUID()}`,
      payload: {},
    });
    await ctx.db.insert(auditEvents).values({
      workspaceId,
      commandId,
      eventType: "workspace.provisioned",
      actorPrincipalId: operator.id,
      scope: "PLATFORM",
      entityType: "workspace",
      entityId: workspaceId,
    });

    const response = await history("workspace", workspaceId);
    expect(response.statusCode).toBe(200);
    const body = historyListResponse.parse(response.json());
    expect(body.items).toEqual([
      expect.objectContaining({
        eventType: "workspace.provisioned",
        actor: { principalId: null, displayName: null, scope: "PLATFORM" },
      }),
    ]);
  });

  it("shows another tenant nothing for the same record id", async () => {
    const response = await history("activity", activityId, "", otherToken);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  it("rejects an entity type outside our row vocabulary", async () => {
    const response = await history("shipment", activityId);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects a malformed entity id", async () => {
    const response = await history("activity", "not-a-uuid");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects a tampered cursor rather than answering a stale first page", async () => {
    const response = await history("activity", activityId, "?cursor=bm90LWEtY3Vyc29y");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
  });

  describe("maintenance entity types", () => {
    async function timeline(entityType: string, entityId: string) {
      const response = await history(entityType, entityId);
      expect(response.statusCode).toBe(200);
      return historyListResponse.parse(response.json());
    }

    it("returns a work order's whole workflow, newest first", async () => {
      const body = await timeline("work_order", workOrderId);

      expect(body.items.map((item) => item.eventType)).toEqual([
        "work_order.asset_released",
        "work_order.completed",
        "work_order.created",
      ]);
      expect(body.items.map((item) => item.command.name)).toEqual([
        "release-asset-to-service",
        "complete-work-order",
        "create-work-order",
      ]);
      for (const item of body.items) {
        expect(item.actor.scope).toBe("WORKSPACE");
        expect(item.actor.displayName).toEqual(expect.any(String));
      }
      // The mechanic declared it complete; the admin signed it back into service.
      const [released, closed] = body.items;
      expect(released?.actor.principalId).toBe(adminPrincipalId);
      expect(closed?.actor.principalId).not.toBe(adminPrincipalId);
    });

    it("serves the signalement that started it, and the completion that resolved it", async () => {
      const body = await timeline("operational_issue", issueId);
      expect(body.items.map((item) => item.eventType)).toEqual([
        "operational_issue.resolved",
        "operational_issue.reported",
      ]);
      expect(body.items[1]?.changedFields).toContain("safetyCritical");
      expect(body.items[0]?.command.name).toBe("complete-work-order");
    });

    it("serves the grounding as an opening and a closing", async () => {
      const body = await timeline(
        "asset_availability_interval",
        availabilityIntervalId,
      );
      expect(body.items.map((item) => item.eventType)).toEqual([
        "asset_availability.closed",
        "asset_availability.opened",
      ]);
    });

    it("shows another tenant nothing for the same work order id", async () => {
      const response = await history("work_order", workOrderId, "", otherToken);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [], nextCursor: null });
    });

    it("diffs the completion as a status move and a declared cost", async () => {
      const body = await timeline("work_order", workOrderId);
      const closure = body.items.find(
        (item) => item.eventType === "work_order.completed",
      );
      if (!closure) throw new Error("no closure event on the seeded work order");

      const response = await ctx.app.inject({
        method: "GET",
        url: `/v1/history/work_order/${workOrderId}/${closure.eventId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);

      const diff = historyEventDiff.parse(response.json());
      // A code with the set that words it, never a bare enum value (#110).
      expect(diff.changes).toContainEqual({
        field: "status",
        kind: "CODE",
        codeSet: "workOrderStatus",
        before: "APPROVED",
        after: "COMPLETED",
      });
      // MONEY, not VALUE: the client formats it against `currency`, never divides.
      // A v1 close's typed amount is recorded as the closer's declaration (#81).
      expect(diff.changes).toContainEqual({
        field: "declaredCostMinor",
        kind: "MONEY",
        before: null,
        after: 325_000,
      });
      expect(diff.changes).toContainEqual({
        field: "summary",
        kind: "VALUE",
        before: null,
        after: "Maître-cylindre et flexibles remplacés",
      });
      expect(diff.changes.map((change) => change.field)).not.toContain(
        "rowVersion",
      );
    });

    it("diffs the release as the grounding's closing timestamp", async () => {
      const body = await timeline(
        "asset_availability_interval",
        availabilityIntervalId,
      );
      const closed = body.items.find(
        (item) => item.eventType === "asset_availability.closed",
      );
      if (!closed) throw new Error("no closing event on the seeded interval");

      const response = await ctx.app.inject({
        method: "GET",
        url: `/v1/history/asset_availability_interval/${availabilityIntervalId}/${closed.eventId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);

      const diff = historyEventDiff.parse(response.json());
      const fields = diff.changes.map((change) => change.field);
      expect(fields).toContain("closedAt");
      expect(fields).toContain("releaseNote");
      // Bookkeeping: the command that closed it is provenance, not history.
      expect(fields).not.toContain("closedByCommandId");
      expect(diff.changes).toContainEqual(
        expect.objectContaining({ field: "releaseNote", after: "Essai routier concluant" }),
      );
    });
  });

  /**
   * #58: every history type with a branch — its own or its parent's — is read
   * against the actor's branch scope, with the same 404 the detail reads give.
   * Workspace-level types keep the module gate alone.
   */
  describe("branch scope", () => {
    let scopedToken: string;
    let scopedAdminToken: string;
    const records: Record<"DLA" | "YDE", Record<string, string>> = { DLA: {}, YDE: {} };
    let categoryId: string;

    beforeAll(async () => {
      const seeded = await seedWorkspace(ctx.db);
      const wsId = seeded.workspace.id;
      await ctx.db
        .insert(branches)
        .values({ workspaceId: wsId, code: "YDE", name: "Yaoundé" });
      const admin = await seedMember(ctx.db, { workspaceId: wsId, role: "ADMIN", allBranches: true });
      scopedAdminToken = (await createSession(ctx.db, { workspaceId: wsId, principalId: admin.principal.id })).token;
      const doualaOnly = await seedMember(ctx.db, {
        workspaceId: wsId,
        role: "ADMIN",
        branchIds: [seeded.branch.id],
      });
      scopedToken = (await createSession(ctx.db, { workspaceId: wsId, principalId: doualaOnly.principal.id })).token;

      for (const branchCode of ["DLA", "YDE"] as const) {
        const as = { token: scopedAdminToken };
        const assetId = await seedAsset(ctx.app, scopedAdminToken, { branchCode });
        const activityId = randomUUID();
        await command(
          "create-activity",
          {
            activityId,
            branchCode,
            activityTypeCode: "HAULAGE_JOB",
            templateCode: "TRUCKING",
            primarySegmentId: randomUUID(),
            primaryAssetId: assetId,
            startedAt: "2026-07-10T06:00:00Z",
          },
          as,
        );
        const documentId = randomUUID();
        await command(
          "add-or-renew-document",
          { documentId, assetId, documentTypeCode: "INSURANCE", expiresAt: "2027-01-01" },
          as,
        );
        const workOrderId = randomUUID();
        await command(
          "create-work-order",
          { workOrderId, assetId, description: "Révision", expectedCostMinor: 0 },
          as,
        );
        const issueId = randomUUID();
        await command(
          "report-issue",
          { issueId, assetId, description: "Bruit", safetyCritical: false },
          as,
        );
        const personId = randomUUID();
        await command(
          "register-person",
          { personId, displayName: `Chauffeur ${branchCode}`, branchCode, defaultRole: "DRIVER" },
          as,
        );
        const readingId = randomUUID();
        await command(
          "record-meter-reading",
          {
            readingId,
            assetId,
            readingType: "ODOMETER",
            value: 120_000,
            observedAt: "2026-07-12T08:00:00Z",
          },
          as,
        );
        records[branchCode] = {
          asset: assetId,
          activity: activityId,
          document: documentId,
          work_order: workOrderId,
          operational_issue: issueId,
          person: personId,
          meter_reading: readingId,
        };
      }

      const [category] = await ctx.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.workspaceId, wsId))
        .limit(1);
      categoryId = category!.id;
    });

    for (const entityType of [
      "asset",
      "activity",
      "document",
      "work_order",
      "operational_issue",
      "person",
      "meter_reading",
    ] as const) {
      it(`404s a ${entityType} outside the reader's branches and serves one inside`, async () => {
        const outside = await history(entityType, records.YDE[entityType]!, "", scopedToken);
        expect(outside.statusCode).toBe(404);
        expect(outside.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });

        const inside = await history(entityType, records.DLA[entityType]!, "", scopedToken);
        expect(inside.statusCode).toBe(200);
        expect(historyListResponse.parse(inside.json()).items.length).toBeGreaterThan(0);

        // The diff is the same side door, and has the same lock.
        const [event] = historyListResponse.parse(
          (await history(entityType, records.YDE[entityType]!, "", scopedAdminToken)).json(),
        ).items;
        const diffResponse = await ctx.app.inject({
          method: "GET",
          url: `/v1/history/${entityType}/${records.YDE[entityType]}/${event!.eventId}`,
          headers: { authorization: `Bearer ${scopedToken}` },
        });
        expect(diffResponse.statusCode).toBe(404);
      });
    }

    it("404s an unknown id of a branch-bearing type for a scoped reader", async () => {
      const response = await history("work_order", randomUUID(), "", scopedToken);
      expect(response.statusCode).toBe(404);
    });

    it("keeps workspace-level types readable across branches", async () => {
      const response = await history("category", categoryId, "", scopedToken);
      expect(response.statusCode).toBe(200);
    });
  });

  /**
   * Review P9: an entry's snapshots carry its amounts, and the workshop is
   * outside the ledger readers. Its reach into an entry's timeline is the
   * entry-evidence rule — every line a work-order cost — and any other entry is
   * the same 404 as one outside its branches, on the timeline and the diff.
   */
  describe("ledger money", () => {
    let plainEntryId: string;
    let repairEntryId: string;
    let mechanicToken: string;
    let approverToken: string;

    async function sessionFor(role: "TECHNICIAN" | "FINANCE") {
      const member = await seedMember(ctx.db, { workspaceId, role, allBranches: true });
      return (await createSession(ctx.db, { workspaceId, principalId: member.principal.id })).token;
    }

    async function eventDiff(entryId: string, authToken: string) {
      const [event] = historyListResponse.parse(
        (await history("financial_entry", entryId)).json(),
      ).items;
      return ctx.app.inject({
        method: "GET",
        url: `/v1/history/financial_entry/${entryId}/${event!.eventId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
    }

    beforeAll(async () => {
      mechanicToken = await sessionFor("TECHNICIAN");
      approverToken = await sessionFor("FINANCE");
      const assetId = await seedAsset(ctx.app, token, { assetCode: "HIST-LEDGER-TRUCK" });
      const expense = {
        branchCode: "DLA",
        economicDate: "2026-08-12",
        paymentMethod: "CASH",
      };

      plainEntryId = randomUUID();
      await command("record-expense", {
        ...expense,
        entryId: plainEntryId,
        categoryCode: "FUEL",
        amountMinor: 30_000,
        postings: [{ assetId, amountMinor: 30_000 }],
      });

      const workOrderId = randomUUID();
      await command("create-work-order", {
        workOrderId,
        assetId,
        description: "Embrayage",
        expectedCostMinor: 80_000,
      });
      repairEntryId = randomUUID();
      await command("record-expense", {
        ...expense,
        entryId: repairEntryId,
        categoryCode: "REPAIRS",
        amountMinor: 80_000,
        postings: [{ assetId, amountMinor: 80_000, workOrderId }],
      });
    });

    it("404s the workshop on an entry that is not a work-order cost", async () => {
      const timeline = await history("financial_entry", plainEntryId, "", mechanicToken);
      expect(timeline.statusCode).toBe(404);
      expect(timeline.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });

      const diffResponse = await eventDiff(plainEntryId, mechanicToken);
      expect(diffResponse.statusCode).toBe(404);
      expect(diffResponse.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    });

    it("serves the workshop an entry whose every line is a work-order cost", async () => {
      const timeline = await history("financial_entry", repairEntryId, "", mechanicToken);
      expect(timeline.statusCode).toBe(200);
      expect(historyListResponse.parse(timeline.json()).items.length).toBeGreaterThan(0);

      const diffResponse = await eventDiff(repairEntryId, mechanicToken);
      expect(diffResponse.statusCode).toBe(200);
      expect(historyEventDiff.parse(diffResponse.json()).changes).toContainEqual(
        expect.objectContaining({ field: "amountMinor", after: 80_000 }),
      );
    });

    it("names the entry's category and branch and sums its lines instead of showing ids and JSON (#119)", async () => {
      const response = await eventDiff(plainEntryId, approverToken);
      expect(response.statusCode).toBe(200);
      const { changes } = historyEventDiff.parse(response.json());

      const [fuel] = await ctx.db
        .select({ labelFr: categories.labelFr, labelEn: categories.labelEn })
        .from(categories)
        .where(and(eq(categories.workspaceId, workspaceId), eq(categories.code, "FUEL")));
      const [douala] = await ctx.db
        .select({ name: branches.name })
        .from(branches)
        .where(and(eq(branches.workspaceId, workspaceId), eq(branches.code, "DLA")));
      expect(changes).toContainEqual({
        field: "categoryId",
        kind: "NAME",
        before: null,
        after: { fr: fuel!.labelFr, en: fuel!.labelEn || fuel!.labelFr },
      });
      expect(changes).toContainEqual({
        field: "branchId",
        kind: "NAME",
        before: null,
        after: { fr: douala!.name, en: douala!.name },
      });
      expect(changes).toContainEqual({
        field: "postings",
        kind: "LINES",
        before: null,
        after: { count: 1, totalMinor: 30_000 },
      });
      expect(changes).toContainEqual({
        field: "paymentMethod",
        kind: "CODE",
        codeSet: "paymentMethod",
        before: null,
        after: "CASH",
      });
    });

    it("says a change whose id names nothing in this workspace is not available, never showing the id", async () => {
      // An entity of its own, so the seeded entries' timelines stay as the commands wrote them.
      const entryId = randomUUID();
      const [event] = await ctx.db
        .insert(auditEvents)
        .values({
          workspaceId,
          commandId: (await ctx.db
            .select({ commandId: auditEvents.commandId })
            .from(auditEvents)
            .where(eq(auditEvents.entityId, plainEntryId))
            .limit(1))[0]!.commandId,
          eventType: "financial_entry.updated",
          actorPrincipalId: adminPrincipalId,
          entityType: "financial_entry",
          entityId: entryId,
          beforeState: { categoryId: randomUUID(), description: "Gasoil" },
          afterState: { categoryId: randomUUID(), description: "Gasoil Douala" },
        })
        .returning({ id: auditEvents.id });
      const response = await ctx.app.inject({
        method: "GET",
        url: `/v1/history/financial_entry/${entryId}/${event!.id}`,
        headers: { authorization: `Bearer ${approverToken}` },
      });
      const { changes } = historyEventDiff.parse(response.json());
      expect(changes).toEqual([
        { field: "categoryId", kind: "UNAVAILABLE" },
        { field: "description", kind: "VALUE", before: "Gasoil", after: "Gasoil Douala" },
      ]);
    });

    /**
     * The guard for #110 and #119: walk every event the real commands wrote on
     * these records and fail on any displayed value that looks like a uuid, a
     * bare enum code or JSON, or a code outside the set that words it.
     */
    it("serves no raw id, bare code or JSON in any real event's diff", async () => {
      const records: Array<[string, string]> = [
        ["activity", activityId],
        ["work_order", workOrderId],
        ["operational_issue", issueId],
        ["asset_availability_interval", availabilityIntervalId],
        ["financial_entry", plainEntryId],
        ["financial_entry", repairEntryId],
        ["asset", maintenanceAssetId],
      ];
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ENUM_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^[A-Z]{4,}$/;
      let checked = 0;
      for (const [entityType, entityId] of records) {
        const { items } = historyListResponse.parse((await history(entityType, entityId)).json());
        expect(items.length, entityType).toBeGreaterThan(0);
        for (const item of items) {
          const response = await ctx.app.inject({
            method: "GET",
            url: `/v1/history/${entityType}/${entityId}/${item.eventId}`,
            headers: { authorization: `Bearer ${token}` },
          });
          const { changes } = historyEventDiff.parse(response.json());
          for (const change of changes) {
            const where = `${entityType} ${item.eventType} ${change.field}`;
            checked += 1;
            // A real command's value always fits its field's shape: a placeholder
            // here means the shape and the writer have drifted apart.
            expect(change.kind, where).not.toBe("UNAVAILABLE");
            if (change.kind === "VALUE") {
              for (const value of [change.before, change.after]) {
                if (typeof value !== "string") continue;
                expect(value, where).not.toMatch(UUID);
                expect(value, where).not.toMatch(ENUM_CODE);
                expect(value, where).not.toMatch(/^[[{]/);
              }
            }
            if (change.kind === "CODE" || change.kind === "CODES") {
              const known: readonly string[] = HISTORY_CODE_SETS[change.codeSet];
              for (const value of [change.before, change.after].flat()) {
                if (value !== null) expect(known, where).toContain(value);
              }
            }
            if (change.kind === "NAME" || change.kind === "NAMES") {
              for (const name of [change.before, change.after].flat()) {
                if (name !== null) expect(name.fr, where).not.toMatch(UUID);
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(20);
    });

    it("serves a ledger reader any entry", async () => {
      const timeline = await history("financial_entry", plainEntryId, "", approverToken);
      expect(timeline.statusCode).toBe(200);
      expect(historyListResponse.parse(timeline.json()).items.length).toBeGreaterThan(0);

      const diffResponse = await eventDiff(plainEntryId, approverToken);
      expect(diffResponse.statusCode).toBe(200);
      expect(historyEventDiff.parse(diffResponse.json()).changes).toContainEqual(
        expect.objectContaining({ field: "amountMinor", after: 30_000 }),
      );
    });
  });

  describe("GET /v1/history/:entityType/:entityId/:eventId", () => {
    /** A borrowed command receipt: the diff read never looks at one. */
    async function anchorCommandId(): Promise<string> {
      const [anchor] = await ctx.db
        .select({ commandId: auditEvents.commandId })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, activityId))
        .limit(1);
      if (!anchor) throw new Error("no audit event to borrow a command from");
      return anchor.commandId;
    }

    async function seedEvent(input: {
      entityType: string;
      entityId: string;
      eventType: string;
      beforeState?: Record<string, unknown>;
      afterState?: Record<string, unknown>;
    }): Promise<string> {
      const [row] = await ctx.db
        .insert(auditEvents)
        .values({
          workspaceId,
          commandId: await anchorCommandId(),
          eventType: input.eventType,
          actorPrincipalId: adminPrincipalId,
          entityType: input.entityType,
          entityId: input.entityId,
          beforeState: input.beforeState ?? null,
          afterState: input.afterState ?? null,
        })
        .returning({ id: auditEvents.id });
      if (!row) throw new Error("audit event insert returned no row");
      return row.id;
    }

    async function diff(
      entityType: string,
      entityId: string,
      eventId: string,
      authToken = token,
    ) {
      return ctx.app.inject({
        method: "GET",
        url: `/v1/history/${entityType}/${entityId}/${eventId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
    }

    async function eventIdOf(eventType: string): Promise<string> {
      const body = historyListResponse.parse(
        (await history("activity", activityId)).json(),
      );
      const item = body.items.find((row) => row.eventType === eventType);
      if (!item) throw new Error(`no ${eventType} event on the seeded activity`);
      return item.eventId;
    }

    it("shows what a real command moved, and drops the bookkeeping columns", async () => {
      const eventId = await eventIdOf("activity.reopened");
      const response = await diff("activity", activityId, eventId);
      expect(response.statusCode).toBe(200);

      const body = historyEventDiff.parse(response.json());
      expect(body.eventId).toBe(eventId);
      expect(body.changes).toContainEqual({
        field: "status",
        kind: "CODE",
        codeSet: "activityStatus",
        before: "CLOSED",
        after: "OPEN",
      });
      expect(body.changes).toContainEqual({
        field: "reason",
        kind: "VALUE",
        before: null,
        after: "Kilométrage de fin corrigé par le bureau",
      });
      // `rowVersion` moved on every one of these writes and means nothing here.
      expect(body.changes.map((change) => change.field)).not.toContain("rowVersion");
    });

    it("serves no state key the allowlist does not name", async () => {
      const eventId = await seedEvent({
        entityType: "activity",
        entityId: activityId,
        eventType: "activity.spiked",
        afterState: {
          status: "CLOSED",
          // None of these are on the activity allowlist. Presence in the row is
          // exactly the case this read exists to survive.
          pinHash: "argon2id$v=19$m=65536",
          internalRiskScore: 0.92,
          workspaceId,
          rowVersion: 7,
        },
      });

      const body = historyEventDiff.parse(
        (await diff("activity", activityId, eventId)).json(),
      );
      expect(body.changes.map((change) => change.field)).toEqual(["status"]);
      expect(JSON.stringify(body)).not.toContain("argon2id");
      expect(JSON.stringify(body)).not.toContain("0.92");
    });

    it("strips credential-shaped keys nested inside an allowed value", async () => {
      const eventId = await seedEvent({
        entityType: "activity",
        entityId: activityId,
        eventType: "activity.created",
        afterState: {
          crew: [
            {
              activityPersonId: "22222222-2222-4222-8222-222222222222",
              personId: "11111111-1111-4111-8111-111111111111",
              role: "DRIVER",
              pinHash: "argon2id$v=19$m=65536",
              apiToken: "rq_live_secret",
            },
          ],
        },
      });

      const raw = await diff("activity", activityId, eventId);
      expect(raw.statusCode).toBe(200);
      expect(raw.body).not.toContain("argon2id");
      expect(raw.body).not.toContain("rq_live_secret");
      // The projection itself drops them, before any display shaping.
      const [crew] = await ctx.db
        .select({ afterState: auditEvents.afterState })
        .from(auditEvents)
        .where(eq(auditEvents.id, eventId));
      expect(diffStates("activity", null, crew?.afterState).find((change) => change.field === "crew")?.after).toEqual([
        {
          activityPersonId: "22222222-2222-4222-8222-222222222222",
          personId: "11111111-1111-4111-8111-111111111111",
          role: "DRIVER",
        },
      ]);
    });

    /**
     * Both trip writers store the crew as the command's payload —
     * `{ activityPersonId, personId, role }`, no name — so these drive the real
     * commands rather than seed a snapshot: a test that hands the read a
     * `displayName` certifies a shape nothing writes.
     */
    it("names the crew of a recorded trip sheet by the people on it, not by their ids", async () => {
      const eventId = await eventIdOf("activity.sheet_recorded");
      const body = historyEventDiff.parse((await diff("activity", activityId, eventId)).json());
      expect(body.changes).toContainEqual({
        field: "crew",
        kind: "NAMES",
        before: null,
        after: [{ fr: "Abdoulaye Sanda", en: "Abdoulaye Sanda" }],
      });
    });

    it("names the crew and the vehicle of a trip opened with create-activity", async () => {
      const tripAssetId = await seedAsset(ctx.app, token, { assetCode: "HIST-CREW-TRUCK" });
      const conductorId = randomUUID();
      await command("register-person", {
        personId: conductorId,
        displayName: "Mireille Ekotto",
        branchCode: "DLA",
        defaultRole: "CONDUCTOR",
      });
      const tripId = randomUUID();
      await command("create-activity", {
        activityId: tripId,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: tripAssetId,
        startedAt: "2026-07-12T06:00:00Z",
        crew: [
          { activityPersonId: randomUUID(), personId: driverId, role: "DRIVER" },
          { activityPersonId: randomUUID(), personId: conductorId, role: "CONDUCTOR" },
        ],
      });
      const { items } = historyListResponse.parse((await history("activity", tripId)).json());
      const created = items.find((item) => item.eventType === "activity.created");
      if (!created) throw new Error("create-activity wrote no activity.created event");

      const body = historyEventDiff.parse((await diff("activity", tripId, created.eventId)).json());
      expect(body.changes).toContainEqual({
        field: "crew",
        kind: "NAMES",
        before: null,
        after: [
          { fr: "Abdoulaye Sanda", en: "Abdoulaye Sanda" },
          { fr: "Mireille Ekotto", en: "Mireille Ekotto" },
        ],
      });
      expect(body.changes).toContainEqual({
        field: "segments",
        kind: "NAMES",
        before: null,
        after: [{ fr: "HIST-CREW-TRUCK", en: "HIST-CREW-TRUCK" }],
      });
      expect(body.changes.map((change) => change.kind)).not.toContain("UNAVAILABLE");
    });

    it("says a crew member who names nobody in this workspace is not available, rather than dropping the change", async () => {
      // An entity of its own, so the real-event guard never walks a hand-made snapshot.
      const entityId = randomUUID();
      const eventId = await seedEvent({
        entityType: "activity",
        entityId,
        eventType: "activity.created",
        afterState: {
          crew: [{ activityPersonId: randomUUID(), personId: randomUUID(), role: "DRIVER" }],
        },
      });
      const body = historyEventDiff.parse((await diff("activity", entityId, eventId)).json());
      expect(body.changes).toEqual([{ field: "crew", kind: "UNAVAILABLE" }]);
    });

    it("hands money back as minor units with the record's own currency", async () => {
      const entryId = randomUUID();
      const eventId = await seedEvent({
        entityType: "financial_entry",
        entityId: entryId,
        eventType: "financial_entry.posted",
        afterState: { amountMinor: 125_000, currency: "XAF", status: "POSTED" },
      });

      const body = historyEventDiff.parse(
        (await diff("financial_entry", entryId, eventId)).json(),
      );
      expect(body.currency).toBe("XAF");
      // XAF has exponent 0: this is 125 000 francs, and nothing divides it.
      expect(body.changes).toContainEqual({
        field: "amountMinor",
        kind: "MONEY",
        before: null,
        after: 125_000,
      });
    });

    it("falls back to the workspace currency when the state carries none", async () => {
      const ruleId = randomUUID();
      const eventId = await seedEvent({
        entityType: "approval_rule",
        entityId: ruleId,
        eventType: "approval-threshold.updated",
        beforeState: { amountMaxMinor: 50_000 },
        afterState: { amountMaxMinor: 200_000 },
      });

      const body = historyEventDiff.parse(
        (await diff("approval_rule", ruleId, eventId)).json(),
      );
      expect(body.currency).toBe("XAF");
      expect(body.changes).toEqual([
        {
          field: "amountMaxMinor",
          kind: "MONEY",
          before: 50_000,
          after: 200_000,
        },
      ]);
    });

    it("treats a creation event as a move from nothing", async () => {
      const readingId = randomUUID();
      const eventId = await seedEvent({
        entityType: "meter_reading",
        entityId: readingId,
        eventType: "meter_reading.recorded",
        afterState: { readingType: "ODOMETER", value: 411_125, source: "MANUAL" },
      });

      const body = historyEventDiff.parse(
        (await diff("meter_reading", readingId, eventId)).json(),
      );
      expect(body.changes).toEqual([
        { field: "readingType", kind: "CODE", codeSet: "readingType", before: null, after: "ODOMETER" },
        // An odometer is not money, whatever the digits look like.
        { field: "value", kind: "VALUE", before: null, after: 411_125 },
        { field: "source", kind: "CODE", codeSet: "readingSource", before: null, after: "MANUAL" },
      ]);
    });

    it("says nothing changed rather than inventing a diff", async () => {
      const eventId = await seedEvent({
        entityType: "activity",
        entityId: activityId,
        eventType: "activity.touched",
        beforeState: { status: "OPEN" },
        afterState: { status: "OPEN" },
      });

      const body = historyEventDiff.parse(
        (await diff("activity", activityId, eventId)).json(),
      );
      expect(body.changes).toEqual([]);
    });

    it("refuses an event that belongs to another record", async () => {
      const eventId = await eventIdOf("activity.closed");
      const response = await diff("activity", randomUUID(), eventId);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: "REFERENCE_NOT_FOUND" },
      });
    });

    it("shows another tenant nothing for an event id it does not own", async () => {
      const eventId = await eventIdOf("activity.closed");
      const response = await diff("activity", activityId, eventId, otherToken);
      expect(response.statusCode).toBe(404);
    });

    it("rejects an entity type outside our row vocabulary", async () => {
      const response = await diff("shipment", activityId, randomUUID());
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });

    it("rejects a malformed event id", async () => {
      const response = await diff("activity", activityId, "not-a-uuid");
      expect(response.statusCode).toBe(400);
    });

    it("lets every allowlisted key through — the two filters never fight", () => {
      // The credential pattern is defence in depth, not a second vocabulary: if
      // it ever starts eating a business field, this is where it shows up.
      for (const entityType of HISTORY_ENTITY_TYPES) {
        for (const key of HISTORY_STATE_KEYS[entityType]) {
          const changes = diffStates(entityType, null, { [key]: "x" });
          expect(
            changes.map((change) => change.field),
            `${entityType}.${key}`,
          ).toEqual([key]);
        }
      }
    });

    it("gates the diff behind the entity's owning module", async () => {
      const seeded = await seedWorkspace(ctx.db);
      const admin = await seedMember(ctx.db, {
        workspaceId: seeded.workspace.id,
        role: "DIRECTOR",
        allBranches: true,
      });
      const gatedToken = (
        await createSession(ctx.db, {
          workspaceId: seeded.workspace.id,
          principalId: admin.principal.id,
        })
      ).token;

      await setModule(ctx.db, seeded.workspace.id, "ACTIVITIES", false);

      const response = await diff(
        "activity",
        randomUUID(),
        randomUUID(),
        gatedToken,
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: { code: "MODULE_DISABLED", metadata: { module: "ACTIVITIES" } },
      });
    });
  });

  it("gates the timeline behind the entity's owning module", async () => {
    const seeded = await seedWorkspace(ctx.db);
    const admin = await seedMember(ctx.db, {
      workspaceId: seeded.workspace.id,
      role: "DIRECTOR",
      allBranches: true,
    });
    const gatedToken = (
      await createSession(ctx.db, {
        workspaceId: seeded.workspace.id,
        principalId: admin.principal.id,
      })
    ).token;

    await setModule(ctx.db, seeded.workspace.id, "ACTIVITIES", false);

    const response = await history("activity", randomUUID(), "", gatedToken);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "MODULE_DISABLED", metadata: { module: "ACTIVITIES" } },
    });
  });
});
