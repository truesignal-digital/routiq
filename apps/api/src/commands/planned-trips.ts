import {
  assignTripPayload,
  cancelPlannedTripPayload,
  planTripPayload,
  rescheduleTripPayload,
  startPlannedTripPayload,
  updatePlannedTripPayload,
  type AssignTripPayload,
  type CancelPlannedTripPayload,
  type CommandEnvelope,
  type CommandWarningCode,
  type CommandWarningMetadata,
  type LegEndpoint,
  type PlanTripPayload,
  type RescheduleTripPayload,
  type StartPlannedTripPayload,
  type TripDiscrepancyCode,
  type UpdatePlannedTripPayload,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  assets,
  meterReadings,
  persons,
} from "../db/schema.js";
import { isModuleEnabled } from "../modules/registry.js";
import { currentBusinessDate } from "../reads/business-date.js";
import { workspaceTimezone } from "../reads/workspace-day.js";
import {
  assetBranchIds,
  branchIdsByCode,
  resolveTargetBranch,
} from "./branch-authorization.js";
import { resolveActivityType } from "./create-activity.js";
import {
  appendAuditEvent,
  appendNoChangeAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type CommandExecuteResult,
  type Tx,
} from "./dispatcher.js";
import { nextActivityNumber } from "./numbering.js";
import { assertOwnTrip } from "./own-records.js";
import { resolveOrCreatePlace } from "./places.js";
import { startedTripWarnings, tripConflicts } from "./trip-conflicts.js";
import { validateCustomValues } from "./templates.js";

/**
 * Planned trips (ADR-0012): the booking is the trip record itself, one status
 * earlier. Five commands edit a PLANNED trip from the office; the sixth starts
 * it, turning the same row OPEN. None of them writes money: the agreed price
 * only pre-fills revenue, which `record-revenue` still records.
 */

type TripRow = typeof activities.$inferSelect;
type TripStatus = TripRow["status"];

const OFFICE = ["DIRECTOR", "ADMIN"] as const;

async function tripBranchIds(
  tx: Tx,
  ctx: CommandContext,
  activityId: string,
): Promise<readonly string[]> {
  const [trip] = await tx
    .select({ branchId: activities.branchId })
    .from(activities)
    .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.id, activityId)))
    .limit(1);
  return trip ? [trip.branchId] : [];
}

/** The trip, locked so two edits of one booking serialize here. */
async function loadTripForUpdate(tx: Tx, ctx: CommandContext, activityId: string): Promise<TripRow> {
  const [trip] = await tx
    .select()
    .from(activities)
    .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.id, activityId)))
    .limit(1)
    .for("update");
  if (!trip) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "activity",
      referenceCode: activityId,
    });
  }
  return trip;
}

function invalidTransition(from: TripStatus, to: TripStatus): CommandError {
  return new CommandError(409, "INVALID_STATE_TRANSITION", { entityType: "activity", from, to });
}

/** The office edits a booking only while it is one; anything else has happened or never will. */
function requirePlanned(trip: TripRow, to: TripStatus): void {
  if (trip.status !== "PLANNED") throw invalidTransition(trip.status, to);
}

async function assertAssetExists(tx: Tx, ctx: CommandContext, assetId: string): Promise<void> {
  const [asset] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, assetId)))
    .limit(1);
  if (!asset) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "asset",
      referenceCode: assetId,
    });
  }
}

/**
 * ADR-0010's rule for an Assigned Driver: an active Person whose usual job is
 * Chauffeur. Any branch: the trip's branch governs, not the driver's.
 */
async function assertEligibleDriver(tx: Tx, ctx: CommandContext, personId: string): Promise<void> {
  const [person] = await tx
    .select({ active: persons.active, defaultRole: persons.defaultRole })
    .from(persons)
    .where(and(eq(persons.workspaceId, ctx.workspaceId), eq(persons.id, personId)))
    .limit(1);
  if (!person) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "person",
      referenceCode: personId,
    });
  }
  if (!person.active) {
    throw new CommandError(422, "DRIVER_INELIGIBLE", { personId, reason: "INACTIVE" });
  }
  if (person.defaultRole !== "DRIVER") {
    throw new CommandError(422, "DRIVER_INELIGIBLE", { personId, reason: "NOT_A_DRIVER" });
  }
}

interface RouteEnd {
  placeId: string | null;
  text: string | null;
}

/** A planned origin or destination, resolved the way legs resolve theirs. */
async function resolveRouteEnd(
  tx: Tx,
  ctx: CommandContext,
  endpoint: LegEndpoint | null,
  commandId: string,
): Promise<RouteEnd> {
  if (endpoint === null) return { placeId: null, text: null };
  if (endpoint.kind === "text") return { placeId: null, text: endpoint.text };
  const placeId = await resolveOrCreatePlace(
    tx,
    ctx,
    { placeId: endpoint.placeId, name: endpoint.name },
    commandId,
  );
  return { placeId, text: null };
}

interface Collisions {
  warnings: CommandWarningCode[];
  warningMetadata?: CommandWarningMetadata;
}

/**
 * Warnings for a planned trip as it now stands in the database (ADR-0012 §4):
 * `tripConflicts`, the rule the planning read recomputes on every read.
 * Disposed vehicles and ineligible drivers are refused before this runs.
 */
async function collisionWarnings(tx: Tx, ctx: CommandContext, tripId: string): Promise<Collisions> {
  const conflicts = (
    await tripConflicts(
      tx,
      {
        workspaceId: ctx.workspaceId,
        timezone: await workspaceTimezone(tx, ctx.workspaceId),
        maintenanceOn: await isModuleEnabled(tx, ctx.workspaceId, "MAINTENANCE"),
      },
      [tripId],
    )
  ).get(tripId);
  if (conflicts === undefined || conflicts.codes.length === 0) return { warnings: [] };
  return Object.keys(conflicts.tripIds).length > 0
    ? { warnings: conflicts.codes, warningMetadata: conflicts.tripIds }
    : { warnings: conflicts.codes };
}

/** The plan as the audit event keeps it, before and after. Money as numbers, like every snapshot. */
function planState(trip: TripRow): Record<string, unknown> {
  return {
    status: trip.status,
    plannedStartAt: trip.plannedStartAt?.toISOString() ?? null,
    plannedEndAt: trip.plannedEndAt?.toISOString() ?? null,
    plannedAssetId: trip.plannedAssetId,
    plannedDriverPersonId: trip.plannedDriverPersonId,
    customerName: trip.customerName,
    clientReference: trip.clientReference,
    description: trip.description,
    plannedOriginPlaceId: trip.plannedOriginPlaceId,
    plannedOriginText: trip.plannedOriginText,
    plannedDestinationPlaceId: trip.plannedDestinationPlaceId,
    plannedDestinationText: trip.plannedDestinationText,
    agreedPriceMinor: trip.agreedPriceMinor === null ? null : Number(trip.agreedPriceMinor),
    amountToCollectMinor:
      trip.amountToCollectMinor === null ? null : Number(trip.amountToCollectMinor),
    priceCurrency: trip.priceCurrency,
    rowVersion: trip.rowVersion,
  };
}

function pick(state: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, state[key]]));
}

type TripChanges = Omit<
  Partial<typeof activities.$inferInsert>,
  "id" | "workspaceId" | "rowVersion" | "createdByCommandId"
>;

/** Writes the changes and bumps the version. The row is already locked and its version checked. */
async function updateTrip(
  tx: Tx,
  ctx: CommandContext,
  trip: TripRow,
  changes: TripChanges,
): Promise<TripRow> {
  const [updated] = await tx
    .update(activities)
    .set({ ...changes, rowVersion: trip.rowVersion + 1 })
    .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.id, trip.id)))
    .returning();
  if (!updated) throw new Error(`locked trip vanished: ${trip.id}`);
  return updated;
}

/**
 * A level 1 edit (ADR-0008) of a PLANNED trip: version checked, the changed
 * keys with their before and after on one audit event, and a no-change event
 * when the request already matches.
 */
async function editPlannedTrip(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  trip: TripRow,
  eventType: string,
  changes: TripChanges,
): Promise<{ trip: TripRow; changed: boolean }> {
  const before = planState(trip);
  const after = planState({ ...trip, ...changes } as TripRow);
  const changedFields = Object.keys(after).filter(
    (key) => key !== "rowVersion" && after[key] !== before[key],
  );
  if (changedFields.length === 0) {
    await appendNoChangeAuditEvent(tx, ctx, envelope, {
      entityType: "activity",
      entityId: trip.id,
      rowVersion: trip.rowVersion,
    });
    return { trip, changed: false };
  }
  const updated = await updateTrip(tx, ctx, trip, changes);
  await appendAuditEvent(tx, ctx, envelope, {
    eventType,
    entityType: "activity",
    entityId: trip.id,
    beforeState: pick(before, [...changedFields, "rowVersion"]),
    afterState: pick(planState(updated), [...changedFields, "rowVersion"]),
    changedFields: [...changedFields, "rowVersion"],
  });
  return { trip: updated, changed: true };
}

function editResult(trip: TripRow, collisions: Collisions = { warnings: [] }): CommandExecuteResult {
  return {
    recordId: trip.id,
    rowVersion: trip.rowVersion,
    recordStatus: trip.status,
    ...collisions,
  };
}

const planTrip: CommandDefinition<PlanTripPayload> = {
  name: "plan-trip",
  version: 1,
  module: "SCHEDULING",
  allowedRoles: OFFICE,
  payloadSchema: planTripPayload,
  operationalAssetId: (payload) => payload.plannedAssetId,
  presetCode: (payload) => payload.templateCode,

  branchAuthorization: {
    kind: "branches",
    async resolve(tx, ctx, payload) {
      const [tripBranch, assetBranches] = await Promise.all([
        branchIdsByCode(tx, ctx, [payload.branchCode]),
        assetBranchIds(tx, ctx, payload.plannedAssetId === undefined ? [] : [payload.plannedAssetId]),
      ]);
      return [...new Set([...tripBranch, ...assetBranches])];
    },
  },

  async approvalContext(_tx, _ctx, payload) {
    return { branchCode: payload.branchCode, categoryCode: payload.activityTypeCode };
  },

  async execute(tx, ctx, envelope, payload) {
    const { branch, warnings: branchWarnings } = await resolveTargetBranch(
      tx,
      ctx,
      envelope,
      payload.branchCode,
    );
    const activityType = await resolveActivityType(tx, ctx, payload.activityTypeCode);
    const templateMeta = validateCustomValues(payload.templateCode, payload.customValues, "activity");
    if (payload.plannedAssetId !== undefined) {
      await assertAssetExists(tx, ctx, payload.plannedAssetId);
    }
    if (payload.plannedDriverPersonId !== undefined) {
      await assertEligibleDriver(tx, ctx, payload.plannedDriverPersonId);
    }
    const [origin, destination] = await Promise.all([
      resolveRouteEnd(tx, ctx, payload.origin ?? null, envelope.commandId),
      resolveRouteEnd(tx, ctx, payload.destination ?? null, envelope.commandId),
    ]);

    // Numbered once from the planned start's business date, and never again,
    // even when the trip is moved into another year (ADR-0012 §2).
    const plannedStartAt = new Date(payload.plannedStartAt);
    const activityNumber = await nextActivityNumber(
      tx,
      ctx,
      branch,
      currentBusinessDate(plannedStartAt, await workspaceTimezone(tx, ctx.workspaceId)),
    );

    const [trip] = await tx
      .insert(activities)
      .values({
        id: payload.activityId,
        workspaceId: ctx.workspaceId,
        branchId: branch.id,
        activityNumber,
        activityTypeId: activityType.id,
        templateCode: payload.templateCode,
        templateVersion: templateMeta.version,
        customValues: payload.customValues,
        status: "PLANNED",
        plannedStartAt,
        plannedEndAt: payload.plannedEndAt === undefined ? null : new Date(payload.plannedEndAt),
        plannedAssetId: payload.plannedAssetId ?? null,
        plannedDriverPersonId: payload.plannedDriverPersonId ?? null,
        customerName: payload.customerName ?? null,
        clientReference: payload.clientReference ?? null,
        description: payload.description ?? null,
        plannedOriginPlaceId: origin.placeId,
        plannedOriginText: origin.text,
        plannedDestinationPlaceId: destination.placeId,
        plannedDestinationText: destination.text,
        agreedPriceMinor:
          payload.agreedPriceMinor === undefined ? null : BigInt(payload.agreedPriceMinor),
        amountToCollectMinor:
          payload.amountToCollectMinor === undefined ? null : BigInt(payload.amountToCollectMinor),
        createdByCommandId: envelope.commandId,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "activity.planned",
      entityType: "activity",
      entityId: trip.id,
      afterState: {
        id: trip.id,
        workspaceId: ctx.workspaceId,
        branchId: branch.id,
        activityNumber,
        activityTypeId: activityType.id,
        activityTypeCode: payload.activityTypeCode,
        templateCode: payload.templateCode,
        templateVersion: templateMeta.version,
        customValues: payload.customValues,
        ...planState(trip),
      },
      changedFields: [
        "id",
        "workspaceId",
        "branchId",
        "activityNumber",
        "activityTypeId",
        "templateCode",
        "templateVersion",
        "customValues",
        ...Object.keys(planState(trip)),
      ],
    });

    const collisions = await collisionWarnings(tx, ctx, trip.id);
    return {
      recordId: trip.id,
      rowVersion: trip.rowVersion,
      recordStatus: "PLANNED",
      warnings: [...branchWarnings, ...collisions.warnings],
      ...(collisions.warningMetadata === undefined
        ? {}
        : { warningMetadata: collisions.warningMetadata }),
    };
  },
};

const assignTrip: CommandDefinition<AssignTripPayload> = {
  name: "assign-trip",
  version: 1,
  module: "SCHEDULING",
  allowedRoles: OFFICE,
  payloadSchema: assignTripPayload,
  operationalAssetId: (payload) => payload.plannedAssetId ?? undefined,

  branchAuthorization: {
    kind: "branches",
    async resolve(tx, ctx, payload) {
      const [tripBranch, assetBranches] = await Promise.all([
        tripBranchIds(tx, ctx, payload.activityId),
        assetBranchIds(tx, ctx, payload.plannedAssetId === null ? [] : [payload.plannedAssetId]),
      ]);
      return [...new Set([...tripBranch, ...assetBranches])];
    },
  },

  async execute(tx, ctx, envelope, payload) {
    const current = await loadTripForUpdate(tx, ctx, payload.activityId);
    checkOptimisticVersion(envelope, current.rowVersion);
    requirePlanned(current, "PLANNED");
    if (payload.plannedAssetId !== null) await assertAssetExists(tx, ctx, payload.plannedAssetId);
    if (payload.plannedDriverPersonId !== null) {
      await assertEligibleDriver(tx, ctx, payload.plannedDriverPersonId);
    }

    const { trip } = await editPlannedTrip(tx, ctx, envelope, current, "activity.assigned", {
      plannedAssetId: payload.plannedAssetId,
      plannedDriverPersonId: payload.plannedDriverPersonId,
    });
    return editResult(trip, await collisionWarnings(tx, ctx, trip.id));
  },
};

const rescheduleTrip: CommandDefinition<RescheduleTripPayload> = {
  name: "reschedule-trip",
  version: 1,
  module: "SCHEDULING",
  allowedRoles: OFFICE,
  payloadSchema: rescheduleTripPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => tripBranchIds(tx, ctx, payload.activityId),
  },

  async execute(tx, ctx, envelope, payload) {
    const current = await loadTripForUpdate(tx, ctx, payload.activityId);
    checkOptimisticVersion(envelope, current.rowVersion);
    requirePlanned(current, "PLANNED");

    const { trip } = await editPlannedTrip(tx, ctx, envelope, current, "activity.rescheduled", {
      plannedStartAt: new Date(payload.plannedStartAt),
      plannedEndAt: payload.plannedEndAt === undefined ? null : new Date(payload.plannedEndAt),
    });
    return editResult(trip, await collisionWarnings(tx, ctx, trip.id));
  },
};

const updatePlannedTrip: CommandDefinition<UpdatePlannedTripPayload> = {
  name: "update-planned-trip",
  version: 1,
  module: "SCHEDULING",
  allowedRoles: OFFICE,
  payloadSchema: updatePlannedTripPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => tripBranchIds(tx, ctx, payload.activityId),
  },

  async execute(tx, ctx, envelope, payload) {
    const current = await loadTripForUpdate(tx, ctx, payload.activityId);
    checkOptimisticVersion(envelope, current.rowVersion);
    requirePlanned(current, "PLANNED");

    const changes: TripChanges = {};
    if (payload.customerName !== undefined) changes.customerName = payload.customerName;
    if (payload.clientReference !== undefined) changes.clientReference = payload.clientReference;
    if (payload.description !== undefined) changes.description = payload.description;
    if (payload.origin !== undefined) {
      const origin = await resolveRouteEnd(tx, ctx, payload.origin, envelope.commandId);
      changes.plannedOriginPlaceId = origin.placeId;
      changes.plannedOriginText = origin.text;
    }
    if (payload.destination !== undefined) {
      const destination = await resolveRouteEnd(tx, ctx, payload.destination, envelope.commandId);
      changes.plannedDestinationPlaceId = destination.placeId;
      changes.plannedDestinationText = destination.text;
    }
    if (payload.agreedPriceMinor !== undefined) {
      changes.agreedPriceMinor =
        payload.agreedPriceMinor === null ? null : BigInt(payload.agreedPriceMinor);
    }
    if (payload.amountToCollectMinor !== undefined) {
      changes.amountToCollectMinor =
        payload.amountToCollectMinor === null ? null : BigInt(payload.amountToCollectMinor);
    }

    const { trip } = await editPlannedTrip(
      tx,
      ctx,
      envelope,
      current,
      "activity.plan_updated",
      changes,
    );
    return editResult(trip);
  },
};

const cancelPlannedTrip: CommandDefinition<CancelPlannedTripPayload> = {
  name: "cancel-planned-trip",
  version: 1,
  module: "SCHEDULING",
  allowedRoles: OFFICE,
  payloadSchema: cancelPlannedTripPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => tripBranchIds(tx, ctx, payload.activityId),
  },

  async execute(tx, ctx, envelope, payload) {
    const current = await loadTripForUpdate(tx, ctx, payload.activityId);
    checkOptimisticVersion(envelope, current.rowVersion);
    // A started trip is never cancelled; it is closed with its gaps (ADR-0012).
    requirePlanned(current, "CANCELLED");

    const trip = await updateTrip(tx, ctx, current, {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByCommandId: envelope.commandId,
      cancellationReason: payload.reason,
      cancellationNote: payload.note ?? null,
    });
    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "activity.cancelled",
      entityType: "activity",
      entityId: trip.id,
      beforeState: { status: current.status, rowVersion: current.rowVersion },
      afterState: {
        status: trip.status,
        cancelledAt: trip.cancelledAt?.toISOString() ?? null,
        cancellationReason: trip.cancellationReason,
        cancellationNote: trip.cancellationNote,
        rowVersion: trip.rowVersion,
      },
      changedFields: ["status", "cancelledAt", "cancellationReason", "cancellationNote", "rowVersion"],
    });
    return editResult(trip);
  },
};

/**
 * PLANNED → OPEN in one transaction: the actual start, set once, and the
 * PRIMARY segment, start reading and crew rows, with client ids, exactly as
 * create-activity writes them. Never a leg, never a posting.
 *
 * No expectedVersion: the truck left. ADR-0012 §5 settles what happens when
 * the trip changed in the meantime.
 */
const startPlannedTrip: CommandDefinition<StartPlannedTripPayload> = {
  name: "start-planned-trip",
  version: 1,
  module: "SCHEDULING",
  allowedRoles: ["DIRECTOR", "ADMIN", "DRIVER"],
  payloadSchema: startPlannedTripPayload,
  operationalAssetId: (payload) => payload.primaryAssetId,

  branchAuthorization: {
    kind: "branches",
    async resolve(tx, ctx, payload) {
      const [tripBranch, assetBranches] = await Promise.all([
        tripBranchIds(tx, ctx, payload.activityId),
        assetBranchIds(tx, ctx, [payload.primaryAssetId]),
      ]);
      return [...new Set([...tripBranch, ...assetBranches])];
    },
  },

  async execute(tx, ctx, envelope, payload) {
    const current = await loadTripForUpdate(tx, ctx, payload.activityId);
    await assertOwnTrip(tx, ctx, ["DRIVER"], current, envelope.origin);

    const warnings: CommandWarningCode[] = [];
    const discrepancies: TripDiscrepancyCode[] = [];
    if (current.status === "CANCELLED" && envelope.origin === "OFFLINE_SYNC") {
      // The driver's later offline commands already name this trip's id, so
      // the cancelled trip is revived rather than replaced (ADR-0012 §5).
      warnings.push("TRIP_STARTED_AFTER_CANCELLATION");
      discrepancies.push("TRIP_STARTED_AFTER_CANCELLATION");
    } else if (current.status !== "PLANNED") {
      throw invalidTransition(current.status, "OPEN");
    }

    await assertAssetExists(tx, ctx, payload.primaryAssetId);
    const crewPersonIds = [...new Set(payload.crew.map((member) => member.personId))];
    if (crewPersonIds.length > 0) {
      const known = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.workspaceId, ctx.workspaceId), inArray(persons.id, crewPersonIds)));
      const knownIds = new Set(known.map((row) => row.id));
      const missing = crewPersonIds.filter((id) => !knownIds.has(id));
      if (missing.length > 0) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", { referenceType: "person", missing });
      }
    }

    const crewDrivers = payload.crew
      .filter((member) => member.role === "DRIVER")
      .map((member) => member.personId);
    const offPlanVehicle =
      current.plannedAssetId !== null && current.plannedAssetId !== payload.primaryAssetId;
    const offPlanDriver =
      current.plannedDriverPersonId !== null &&
      crewDrivers.length > 0 &&
      !crewDrivers.includes(current.plannedDriverPersonId);
    if (offPlanVehicle || offPlanDriver) warnings.push("TRIP_STARTED_OFF_PLAN");

    const startedAt = new Date(payload.startedAt);
    if (payload.startReading) {
      await tx.insert(meterReadings).values({
        id: payload.startReading.readingId,
        workspaceId: ctx.workspaceId,
        assetId: payload.primaryAssetId,
        readingType: payload.startReading.readingType,
        value: BigInt(payload.startReading.value),
        observedAt: new Date(payload.startReading.observedAt),
        source: "ACTIVITY_START",
        activityId: current.id,
        createdByCommandId: envelope.commandId,
      });
    }
    await tx.insert(activityAssetSegments).values({
      id: payload.primarySegmentId,
      workspaceId: ctx.workspaceId,
      activityId: current.id,
      assetId: payload.primaryAssetId,
      role: "PRIMARY",
      startedAt,
      ...(payload.startReading === undefined
        ? {}
        : { startReadingId: payload.startReading.readingId }),
      createdByCommandId: envelope.commandId,
    });
    if (payload.crew.length > 0) {
      await tx.insert(activityPeople).values(
        payload.crew.map((member) => ({
          id: member.activityPersonId,
          workspaceId: ctx.workspaceId,
          activityId: current.id,
          personId: member.personId,
          role: member.role,
          createdByCommandId: envelope.commandId,
        })),
      );
    }

    const trip = await updateTrip(tx, ctx, current, {
      status: "OPEN",
      startedAt,
      discrepancyCodes: [...new Set([...current.discrepancyCodes, ...discrepancies])],
    });
    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "activity.started",
      entityType: "activity",
      entityId: trip.id,
      beforeState: {
        status: current.status,
        startedAt: null,
        discrepancyCodes: current.discrepancyCodes,
        rowVersion: current.rowVersion,
      },
      afterState: {
        status: trip.status,
        startedAt: startedAt.toISOString(),
        discrepancyCodes: trip.discrepancyCodes,
        rowVersion: trip.rowVersion,
        segments: [
          {
            id: payload.primarySegmentId,
            assetId: payload.primaryAssetId,
            role: "PRIMARY",
            startedAt: startedAt.toISOString(),
            endedAt: null,
            startReadingId: payload.startReading?.readingId ?? null,
          },
        ],
        crew: payload.crew,
      },
      changedFields: ["status", "startedAt", "discrepancyCodes", "rowVersion", "segments", "crew"],
    });

    // The vehicle may be grounded, or it or the driver still on another
    // unfinished trip: the truck left, so the start stands and says so, live
    // or replayed (#577, #653).
    const collisions = await startedTripWarnings(
      tx,
      {
        workspaceId: ctx.workspaceId,
        timezone: await workspaceTimezone(tx, ctx.workspaceId),
        maintenanceOn: await isModuleEnabled(tx, ctx.workspaceId, "MAINTENANCE"),
      },
      trip.id,
    );
    return {
      recordId: trip.id,
      rowVersion: trip.rowVersion,
      recordStatus: "OPEN",
      warnings: [...warnings, ...collisions.warnings],
      ...(collisions.warningMetadata === undefined
        ? {}
        : { warningMetadata: collisions.warningMetadata }),
    };
  },
};

registerCommand(planTrip);
registerCommand(assignTrip);
registerCommand(rescheduleTrip);
registerCommand(updatePlannedTrip);
registerCommand(cancelPlannedTrip);
registerCommand(startPlannedTrip);
