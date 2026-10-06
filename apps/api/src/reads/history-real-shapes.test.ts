import { randomUUID } from "node:crypto";
import {
  activityDetail,
  HISTORY_ENTITY_TYPES,
  HISTORY_FIELD_SHAPES,
  historyEventDiff,
  type HistoryEntityType,
  type HistoryFieldShape,
} from "@routiq/contracts";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { resolveOperatorContext } from "../auth/context.js";
import { dispatchCommand } from "../commands/dispatcher.js";
import { platformDb } from "../db/platform.js";
import { auditEvents, postingPeriods, principals } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset } from "../test/seed.js";
import { diffStates } from "./history.js";
import "../server.js";

/**
 * The record history sheet words each allowlisted key by its declared shape
 * (`HISTORY_FIELD_SHAPES`). A shape is only as good as its agreement with what
 * the commands actually store: a crew shape that expected a `displayName` no
 * writer records hid every real trip's crew behind a passing test that seeded
 * the name by hand (PR #469 review). So this suite seeds nothing by hand. It
 * provisions a workspace and drives the real commands, then reads every event
 * they wrote back through the diff read and requires each moved field to come
 * out in words — never `UNAVAILABLE`, never silently missing.
 */
describe("record history against the shapes the real commands store", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let director: string;
  let manager: Actor;
  let mechanic: Actor;

  async function ok(
    name: string,
    payload: Record<string, unknown>,
    options: { token?: string; expectedVersion?: number } = {},
  ) {
    return api.ok(
      options.token ?? director,
      name,
      payload,
      options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion },
    );
  }

  async function activityVersion(activityId: string): Promise<number> {
    const response = await api.get(director, `/v1/activities/${activityId}`);
    return activityDetail.parse(response.body).rowVersion;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);

    // The workspace itself comes from the real provisioning command, so its
    // own event (branches, presets, modules) is part of what gets checked.
    const [operatorRow] = await ctx.db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
      .returning();
    const operator = await resolveOperatorContext(ctx.db, operatorRow!.id);
    if (!operator) throw new Error("operator context did not resolve");
    workspaceId = randomUUID();
    const adminId = randomUUID();
    const slug = `shapes-${randomUUID().slice(0, 8)}`;
    const provisioned = await dispatchCommand(platformDb(ctx.db), operator, {
      name: "provision-workspace",
      version: 3,
      envelope: { commandId: randomUUID(), idempotencyKey: `idem-${randomUUID()}`, origin: "API" },
      payload: {
        workspace: { id: workspaceId, slug, name: "Transports Formes" },
        branches: [
          { id: randomUUID(), code: "DLA", name: "Douala" },
          { id: randomUUID(), code: "YDE", name: "Yaoundé" },
        ],
        admin: { id: adminId, displayName: "Awa Ndongo", username: `admin-${slug}`, pin: "482913" },
        enabledPresets: ["TRUCKING"],
        disabledModules: [],
      },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(200);
    director = (await createSession(ctx.db, { workspaceId, principalId: adminId })).token;
    manager = await seedActor(ctx.db, { workspaceId, role: "ADMIN", displayName: "Boris" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN", displayName: "Hervé" });

    // People and vehicles.
    const driverId = randomUUID();
    const conductorId = randomUUID();
    await ok("register-person", { personId: driverId, displayName: "Abdoulaye Sanda", branchCode: "DLA", defaultRole: "DRIVER" });
    await ok("register-person", { personId: conductorId, displayName: "Mireille Ekotto", branchCode: "DLA", defaultRole: "CONDUCTOR" });
    const truck = await seedAsset(ctx.app, director, { assetCode: "LT-101" });
    const spare = await seedAsset(ctx.app, director, { assetCode: "LT-202" });
    await ok("update-asset-details", { assetId: truck, manufacturer: "Renault", registrationNumber: "LT 101 AB" }, { expectedVersion: 1 });
    await ok("commission-asset", { assetId: truck }, { expectedVersion: 2 });
    await ok("assign-asset", { assetId: truck, custodianMembershipId: manager.membershipId }, { expectedVersion: 3 });

    // A trip opened, crewed, legged, substituted, closed and reopened.
    const tripId = randomUUID();
    const primarySegmentId = randomUUID();
    await ok("create-activity", {
      activityId: tripId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId,
      primaryAssetId: truck,
      startedAt: "2026-07-12T06:00:00Z",
      startReading: { readingId: randomUUID(), readingType: "ODOMETER", value: 100_000, observedAt: "2026-07-12T06:00:00Z" },
      customerName: "Cimencam",
      crew: [
        { activityPersonId: randomUUID(), personId: driverId, role: "DRIVER" },
        { activityPersonId: randomUUID(), personId: conductorId, role: "CONDUCTOR" },
      ],
    });
    await ok("record-movement-leg", {
      legId: randomUUID(),
      activityId: tripId,
      legNo: 1,
      origin: { kind: "text", text: "Douala" },
      destination: { kind: "text", text: "Edéa" },
      distanceKm: 62,
      loadState: "LADEN",
    });
    await ok(
      "substitute-asset",
      {
        activityId: tripId,
        outgoingSegmentId: primarySegmentId,
        newSegmentId: randomUUID(),
        substituteAssetId: spare,
        handoverAt: "2026-07-12T09:00:00Z",
        reason: "Crevaison",
      },
      { expectedVersion: await activityVersion(tripId) },
    );
    await ok(
      "close-activity",
      { activityId: tripId, endedAt: "2026-07-12T18:00:00Z", note: "Livré" },
      { expectedVersion: await activityVersion(tripId) },
    );
    await ok("reopen-activity", { activityId: tripId, reason: "Distance à corriger" }, { expectedVersion: await activityVersion(tripId) });
    await ok("record-meter-reading", {
      readingId: randomUUID(),
      assetId: spare,
      readingType: "ODOMETER",
      value: 50_000,
      observedAt: "2026-07-13T08:00:00Z",
    });

    // A sheet recorded in one go, the other trip writer.
    await ok("record-haulage-job-sheet", {
      activityId: randomUUID(),
      close: true,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId: spare,
      startedAt: "2026-07-14T06:10:00Z",
      endedAt: "2026-07-14T18:00:00Z",
      customerName: "Brasseries du Cameroun",
      crew: [{ activityPersonId: randomUUID(), personId: driverId, role: "DRIVER" }],
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

    // Money: an expense on the truck, a revenue, a reversal.
    const expenseId = randomUUID();
    const expense = await ok("record-expense", {
      entryId: expenseId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-12",
      amountMinor: 30_000,
      paymentMethod: "CASH",
      description: "Gasoil",
      postings: [{ assetId: truck, amountMinor: 30_000 }],
    });
    await ok("record-revenue", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FREIGHT_REVENUE",
      economicDate: "2026-07-12",
      amountMinor: 450_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor: 450_000 }],
    });
    await ok(
      "reverse-entry",
      { originalEntryId: expenseId, reversalEntryId: randomUUID(), reason: "Saisi deux fois" },
      { expectedVersion: expense.rowVersion },
    );

    // Maintenance: a signalement, a work order through completion and release.
    const issueId = randomUUID();
    await ok("report-issue", { issueId, assetId: truck, description: "Fuite de frein", safetyCritical: true, category: "BRAKES" });
    const workOrderId = randomUUID();
    const created = await ok("create-work-order", {
      workOrderId,
      assetId: truck,
      issueId,
      description: "Réfection du circuit de freinage",
      expectedCostMinor: 300_000,
    });
    await ok(
      "complete-work-order",
      { workOrderId, actualCostMinor: 325_000, summary: "Maître-cylindre remplacé" },
      { token: mechanic.token, expectedVersion: created.rowVersion },
    );
    await ok("release-asset-to-service", { assetId: truck, workOrderId, note: "Essai routier concluant" });
    const minorIssue = randomUUID();
    await ok("report-issue", { issueId: minorIssue, assetId: spare, description: "Rétroviseur fissuré", safetyCritical: false });
    await ok("dismiss-issue", { issueId: minorIssue, reason: "Déjà remplacé" }, { expectedVersion: 1 });
    const cancelled = randomUUID();
    const cancelledCreated = await ok("create-work-order", {
      workOrderId: cancelled,
      assetId: spare,
      description: "Vidange",
      expectedCostMinor: 40_000,
    });
    await ok("cancel-work-order", { workOrderId: cancelled, reason: "Doublon" }, { expectedVersion: cancelledCreated.rowVersion });

    // Notes and documents, one renewed so a supersession is on record.
    await ok("add-note", { noteId: randomUUID(), entityType: "asset", entityId: truck, body: "Garé à Bonabéri" });
    const firstPolicy = randomUUID();
    await ok("add-or-renew-document", {
      documentId: firstPolicy,
      assetId: truck,
      documentTypeCode: "INSURANCE",
      documentNumber: "POL-2026-118",
      expiresAt: "2026-12-31",
    });
    await ok("add-or-renew-document", {
      documentId: randomUUID(),
      assetId: truck,
      documentTypeCode: "INSURANCE",
      documentNumber: "POL-2027-007",
      expiresAt: "2027-12-31",
      supersedesDocumentId: firstPolicy,
    });

    // Workspace settings: categories, a period, a threshold, a module, a preset.
    const categoryId = randomUUID();
    await ok("create-category", { id: categoryId, kind: "EXPENSE_CATEGORY", code: "PEAGE", labelFr: "Péage", labelEn: "Toll", profitabilityLayer: "DIRECT", evidencePolicy: "RECEIPT_EXPECTED" });
    await ok("relabel-category", { categoryId, labelFr: "Péage autoroute", labelEn: "Highway toll" }, { expectedVersion: 1 });
    await ok("deactivate-category", { categoryId }, { expectedVersion: 2 });
    const periodVersion = async () =>
      (
        await ctx.db
          .select({ rowVersion: postingPeriods.rowVersion })
          .from(postingPeriods)
          .where(and(eq(postingPeriods.workspaceId, workspaceId), eq(postingPeriods.periodCode, "2026-07")))
      )[0]!.rowVersion;
    await ok("lock-period", { periodCode: "2026-07" }, { expectedVersion: await periodVersion() });
    await ok("reopen-period", { periodCode: "2026-07", reason: "Facture oubliée" }, { expectedVersion: await periodVersion() });
    await ok("update-approval-threshold", { commandType: "record-expense", amountMaxMinor: 250_000 });
    await ok("update-approval-threshold", { commandType: "record-expense", amountMaxMinor: 400_000 });
    await ok("disable-module", { moduleCode: "DOCUMENTS" });
    await ok("enable-module", { moduleCode: "DOCUMENTS" });
    await ok("set-template-preset", { presetCode: "PASSENGER_TRANSPORT", enabled: true });
  }, 120_000);

  afterAll(async () => ctx.close());

  it("words every field every real command moved, and leaves none out", async () => {
    const events = await ctx.db
      .select({
        id: auditEvents.id,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        eventType: auditEvents.eventType,
        beforeState: auditEvents.beforeState,
        afterState: auditEvents.afterState,
      })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId))
      .orderBy(asc(auditEvents.occurredAt));

    const shown = new Set<string>();
    for (const event of events) {
      if (!(HISTORY_ENTITY_TYPES as readonly string[]).includes(event.entityType)) continue;
      const entityType = event.entityType as HistoryEntityType;
      const response = await api.get(director, `/v1/history/${entityType}/${event.entityId}/${event.id}`);
      expect(response.status, `${event.eventType}: ${JSON.stringify(response.body)}`).toBe(200);
      const { changes } = historyEventDiff.parse(response.body);

      for (const change of changes) {
        const where = `${entityType} ${event.eventType} ${change.field}`;
        expect(change.kind, where).not.toBe("UNAVAILABLE");
        shown.add(`${entityType}.${change.field}`);
      }

      // Everything the allowlist let through, bar the bag only the vehicle tab
      // words and lists that stayed empty, reaches the reader: the director may
      // see money, so nothing here is held back by permission.
      const shapes: Record<string, HistoryFieldShape> = HISTORY_FIELD_SHAPES[entityType];
      const expected = diffStates(entityType, event.beforeState, event.afterState)
        .filter((change) => shapes[change.field] !== "HIDDEN")
        .filter((change) => !(isEmpty(change.before) && isEmpty(change.after)))
        .map((change) => change.field);
      expect(changes.map((change) => change.field), `${entityType} ${event.eventType}`).toEqual(expected);
    }

    // Every way a field can be shown was exercised by a real write at least
    // once: a shape no command reaches here is a shape nothing has checked.
    const reached = new Set<string>();
    for (const key of shown) {
      const [entityType, field] = key.split(".") as [HistoryEntityType, string];
      reached.add(shapeKey((HISTORY_FIELD_SHAPES[entityType] as Record<string, HistoryFieldShape>)[field]!));
    }
    const declared = new Set(
      HISTORY_ENTITY_TYPES.flatMap((entityType) =>
        Object.values(HISTORY_FIELD_SHAPES[entityType] as Record<string, HistoryFieldShape>)
          .filter((shape) => shape !== "HIDDEN")
          .map(shapeKey),
      ),
    );
    expect([...declared].filter((shape) => !reached.has(shape)).sort()).toEqual([]);
  });
});

const isEmpty = (value: unknown) => value === null || (Array.isArray(value) && value.length === 0);

/** A shape's kind, with name sources told apart: each lookup is its own way to fail. */
function shapeKey(shape: HistoryFieldShape): string {
  if (typeof shape === "string") return shape;
  if ("name" in shape) return `name:${shape.name}`;
  return "code" in shape ? "code" : "codes";
}
