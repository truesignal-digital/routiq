import {
  recordMeterReadingPayload,
  recordMovementLegPayload,
  type CommandWarningCode,
  type LegEndpoint,
} from "@routiq/contracts";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import {
  activities,
  activityAssetSegments,
  meterReadings,
  movementLegs,
} from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";
import { resolveOrCreatePlace } from "./places.js";

type RecordMovementLegPayload = z.infer<typeof recordMovementLegPayload>;
type RecordMeterReadingPayload = z.infer<typeof recordMeterReadingPayload>;

interface OpenActivity {
  id: string;
  branchId: string;
  status: "OPEN" | "CLOSED";
}

async function loadOpenActivity(
  tx: Tx,
  ctx: CommandContext,
  activityId: string,
): Promise<OpenActivity> {
  const [activity] = await tx
    .select({
      id: activities.id,
      branchId: activities.branchId,
      status: activities.status,
    })
    .from(activities)
    .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.id, activityId)))
    .limit(1);
  if (!activity) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "activity",
      referenceCode: activityId,
    });
  }
  if (activity.status === "CLOSED") {
    // Reopening is the ceremony (§5.1: ReopenActivity costs one approval);
    // silently appending to a closed job would make its completeness a lie.
    throw new CommandError(409, "INVALID_STATE_TRANSITION", {
      entityType: "activity",
      status: activity.status,
    });
  }
  return activity;
}

async function resolveEndpoint(
  tx: Tx,
  ctx: CommandContext,
  endpoint: LegEndpoint,
  commandId: string,
): Promise<{ placeId?: string; text?: string }> {
  if (endpoint.kind === "text") return { text: endpoint.text };
  const placeId = await resolveOrCreatePlace(
    tx,
    ctx,
    { placeId: endpoint.placeId, name: endpoint.name },
    commandId,
  );
  return { placeId };
}

/**
 * Appending a leg mutates nothing on the activity, so it carries no
 * expectedVersion — row_version belongs to the row you change. An offline client
 * could not know a current version anyway, and §6 is explicit that physical
 * facts captured in the field are accepted, not rejected.
 */
const recordMovementLeg: CommandDefinition<RecordMovementLegPayload> = {
  name: "record-movement-leg",
  version: 1,
  module: "ACTIVITIES",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"],
  payloadSchema: recordMovementLegPayload,

  branchAuthorization: {
    kind: "branches",
    async resolve(tx, ctx, payload) {
      const [activity] = await tx
        .select({ branchId: activities.branchId })
        .from(activities)
        .where(
          and(
            eq(activities.workspaceId, ctx.workspaceId),
            eq(activities.id, payload.activityId),
          ),
        )
        .limit(1);
      return activity ? [activity.branchId] : [];
    },
  },

  async execute(tx, ctx, envelope, payload) {
    await loadOpenActivity(tx, ctx, payload.activityId);

    if (payload.segmentId !== undefined) {
      const [segment] = await tx
        .select({ id: activityAssetSegments.id })
        .from(activityAssetSegments)
        .where(
          and(
            eq(activityAssetSegments.workspaceId, ctx.workspaceId),
            eq(activityAssetSegments.id, payload.segmentId),
            eq(activityAssetSegments.activityId, payload.activityId),
          ),
        )
        .limit(1);
      if (!segment) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "segment",
          referenceCode: payload.segmentId,
        });
      }
    }

    const [origin, destination] = await Promise.all([
      resolveEndpoint(tx, ctx, payload.origin, envelope.commandId),
      resolveEndpoint(tx, ctx, payload.destination, envelope.commandId),
    ]);

    await tx.insert(movementLegs).values({
      id: payload.legId,
      workspaceId: ctx.workspaceId,
      activityId: payload.activityId,
      legNo: payload.legNo,
      ...(payload.segmentId === undefined ? {} : { segmentId: payload.segmentId }),
      ...(origin.placeId === undefined ? {} : { originPlaceId: origin.placeId }),
      ...(origin.text === undefined ? {} : { originText: origin.text }),
      ...(destination.placeId === undefined
        ? {}
        : { destinationPlaceId: destination.placeId }),
      ...(destination.text === undefined ? {} : { destinationText: destination.text }),
      ...(payload.departedAt === undefined
        ? {}
        : { departedAt: new Date(payload.departedAt) }),
      ...(payload.arrivedAt === undefined ? {} : { arrivedAt: new Date(payload.arrivedAt) }),
      ...(payload.distanceKm === undefined ? {} : { distanceKm: payload.distanceKm }),
      ...(payload.loadState === undefined ? {} : { loadState: payload.loadState }),
      ...(payload.passengerCount === undefined
        ? {}
        : { passengerCount: payload.passengerCount }),
      customValues: payload.customValues,
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "movement_leg.recorded",
      entityType: "movement_leg",
      entityId: payload.legId,
      afterState: {
        id: payload.legId,
        workspaceId: ctx.workspaceId,
        activityId: payload.activityId,
        legNo: payload.legNo,
        segmentId: payload.segmentId ?? null,
        originPlaceId: origin.placeId ?? null,
        originText: origin.text ?? null,
        destinationPlaceId: destination.placeId ?? null,
        destinationText: destination.text ?? null,
        departedAt: payload.departedAt ?? null,
        arrivedAt: payload.arrivedAt ?? null,
        distanceKm: payload.distanceKm ?? null,
        loadState: payload.loadState ?? null,
        passengerCount: payload.passengerCount ?? null,
        customValues: payload.customValues,
      },
      changedFields: [
        "id",
        "workspaceId",
        "activityId",
        "legNo",
        "segmentId",
        "originPlaceId",
        "originText",
        "destinationPlaceId",
        "destinationText",
        "departedAt",
        "arrivedAt",
        "distanceKm",
        "loadState",
        "passengerCount",
        "customValues",
      ],
    });

    return { recordId: payload.legId, rowVersion: 1 };
  },
};

const recordMeterReading: CommandDefinition<RecordMeterReadingPayload> = {
  name: "record-meter-reading",
  version: 1,
  module: "ACTIVITIES",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE"],
  payloadSchema: recordMeterReadingPayload,
  operationalAssetId: (payload) => payload.assetId,

  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async execute(tx, ctx, envelope, payload) {
    if (payload.activityId !== undefined) {
      await loadOpenActivity(tx, ctx, payload.activityId);
    }

    // Latest live observation of the same meter — superseded rows are history.
    const [previous] = await tx
      .select({ id: meterReadings.id, value: meterReadings.value })
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.workspaceId, ctx.workspaceId),
          eq(meterReadings.assetId, payload.assetId),
          eq(meterReadings.readingType, payload.readingType),
          isNull(meterReadings.supersededById),
        ),
      )
      .orderBy(desc(meterReadings.observedAt))
      .limit(1);

    const warnings: CommandWarningCode[] = [];
    // §3.1: decreases warn, never silently accepted — and never blocked either,
    // because a swapped instrument or a mis-keyed digit is a fact to reconcile,
    // not a submission to refuse (§6).
    if (
      previous !== undefined &&
      payload.supersedesReadingId === undefined &&
      BigInt(payload.value) < previous.value
    ) {
      warnings.push("METER_READING_DECREASED");
    }

    await tx.insert(meterReadings).values({
      id: payload.readingId,
      workspaceId: ctx.workspaceId,
      assetId: payload.assetId,
      readingType: payload.readingType,
      value: BigInt(payload.value),
      observedAt: new Date(payload.observedAt),
      source: payload.source,
      ...(payload.activityId === undefined ? {} : { activityId: payload.activityId }),
      createdByCommandId: envelope.commandId,
    });

    if (payload.supersedesReadingId !== undefined) {
      const [original] = await tx
        .select({ id: meterReadings.id, supersededById: meterReadings.supersededById })
        .from(meterReadings)
        .where(
          and(
            eq(meterReadings.workspaceId, ctx.workspaceId),
            eq(meterReadings.id, payload.supersedesReadingId),
          ),
        )
        .limit(1);
      if (!original) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "meterReading",
          referenceCode: payload.supersedesReadingId,
        });
      }
      if (original.supersededById !== null) {
        throw new CommandError(409, "INVALID_STATE_TRANSITION", {
          entityType: "meter_reading",
          reason: "already superseded",
        });
      }
      // The original row is never edited beyond this link — the observation it
      // recorded stays exactly as it was written.
      await tx
        .update(meterReadings)
        .set({
          supersededById: payload.readingId,
          supersedeReason: payload.supersedeReason ?? null,
        })
        .where(
          and(
            eq(meterReadings.workspaceId, ctx.workspaceId),
            eq(meterReadings.id, payload.supersedesReadingId),
          ),
        );
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType:
        payload.supersedesReadingId === undefined
          ? "meter_reading.recorded"
          : "meter_reading.corrected",
      entityType: "meter_reading",
      entityId: payload.readingId,
      afterState: {
        id: payload.readingId,
        workspaceId: ctx.workspaceId,
        assetId: payload.assetId,
        readingType: payload.readingType,
        value: payload.value,
        observedAt: payload.observedAt,
        source: payload.source,
        activityId: payload.activityId ?? null,
        supersedesReadingId: payload.supersedesReadingId ?? null,
        supersedeReason: payload.supersedeReason ?? null,
      },
      changedFields: [
        "id",
        "workspaceId",
        "assetId",
        "readingType",
        "value",
        "observedAt",
        "source",
        "activityId",
        "supersedesReadingId",
        "supersedeReason",
      ],
    });

    return { recordId: payload.readingId, rowVersion: 1, warnings };
  },
};

registerCommand(recordMovementLeg);
registerCommand(recordMeterReading);
