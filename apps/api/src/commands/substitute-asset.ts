import { substituteAssetPayload } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { activities, activityAssetSegments, meterReadings } from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { assertOwnRecord } from "./own-records.js";

type SubstituteAssetPayload = z.infer<typeof substituteAssetPayload>;

const substituteAsset: CommandDefinition<SubstituteAssetPayload> = {
  name: "substitute-asset",
  version: 1,
  module: "ACTIVITIES",
  allowedRoles: ["DIRECTOR", "ADMIN", "DRIVER"],
  payloadSchema: substituteAssetPayload,
  operationalAssetId: (payload) => payload.substituteAssetId,

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
      const assetBranches = await assetBranchIds(tx, ctx, [payload.substituteAssetId]);
      return [...new Set([...(activity ? [activity.branchId] : []), ...assetBranches])];
    },
  },

  async execute(tx, ctx, envelope, payload) {
    const [activity] = await tx
      .select({
        id: activities.id,
        status: activities.status,
        createdByCommandId: activities.createdByCommandId,
      })
      .from(activities)
      .where(
        and(
          eq(activities.workspaceId, ctx.workspaceId),
          eq(activities.id, payload.activityId),
        ),
      )
      .limit(1);
    if (!activity) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "activity",
        referenceCode: payload.activityId,
      });
    }
    await assertOwnRecord(tx, ctx, ["DRIVER"], {
      entityType: "activity",
      id: activity.id,
      createdByCommandId: activity.createdByCommandId,
    });
    if (activity.status === "CLOSED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        entityType: "activity",
        status: activity.status,
      });
    }

    // FOR UPDATE: two clerks recording a handover at once must serialize here,
    // not race into the exclusion constraint with a confusing 23P01.
    const [outgoing] = await tx
      .select({
        id: activityAssetSegments.id,
        assetId: activityAssetSegments.assetId,
        role: activityAssetSegments.role,
        startedAt: activityAssetSegments.startedAt,
        endedAt: activityAssetSegments.endedAt,
        rowVersion: activityAssetSegments.rowVersion,
      })
      .from(activityAssetSegments)
      .where(
        and(
          eq(activityAssetSegments.workspaceId, ctx.workspaceId),
          eq(activityAssetSegments.id, payload.outgoingSegmentId),
          eq(activityAssetSegments.activityId, payload.activityId),
        ),
      )
      .limit(1)
      .for("update");
    if (!outgoing) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "segment",
        referenceCode: payload.outgoingSegmentId,
      });
    }

    checkOptimisticVersion(envelope, outgoing.rowVersion);

    if (outgoing.role !== "PRIMARY" && outgoing.role !== "SUBSTITUTE") {
      // A trailer or recovery vehicle is not the carrier; substituting one is a
      // different act, and pretending otherwise would corrupt the timeline.
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        entityType: "activity_asset_segment",
        reason: "not a carrier segment",
        role: outgoing.role,
      });
    }
    if (outgoing.endedAt !== null) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        entityType: "activity_asset_segment",
        reason: "already closed",
      });
    }
    if (payload.substituteAssetId === outgoing.assetId) {
      throw new CommandError(422, "VALIDATION_FAILED", {
        reason: "substitute must differ from the outgoing asset",
      });
    }

    const handoverAt = new Date(payload.handoverAt);
    if (handoverAt <= outgoing.startedAt) {
      throw new CommandError(422, "VALIDATION_FAILED", {
        reason: "handover must fall after the segment started",
        startedAt: outgoing.startedAt.toISOString(),
      });
    }

    // Readings first: the segments reference them.
    if (payload.outgoingReading) {
      await tx.insert(meterReadings).values({
        id: payload.outgoingReading.readingId,
        workspaceId: ctx.workspaceId,
        assetId: outgoing.assetId,
        readingType: payload.outgoingReading.readingType,
        value: BigInt(payload.outgoingReading.value),
        observedAt: new Date(payload.outgoingReading.observedAt),
        source: "SUBSTITUTION",
        activityId: payload.activityId,
        createdByCommandId: envelope.commandId,
      });
    }
    if (payload.incomingReading) {
      await tx.insert(meterReadings).values({
        id: payload.incomingReading.readingId,
        workspaceId: ctx.workspaceId,
        assetId: payload.substituteAssetId,
        readingType: payload.incomingReading.readingType,
        value: BigInt(payload.incomingReading.value),
        observedAt: new Date(payload.incomingReading.observedAt),
        source: "SUBSTITUTION",
        activityId: payload.activityId,
        createdByCommandId: envelope.commandId,
      });
    }

    // Order is load-bearing. The exclusion constraint is checked per statement,
    // so the outgoing segment must be closed BEFORE the replacement opens;
    // `[)` bounds then let [start, handover) and [handover, inf) abut.
    await tx
      .update(activityAssetSegments)
      .set({
        endedAt: handoverAt,
        rowVersion: outgoing.rowVersion + 1,
        ...(payload.outgoingReading === undefined
          ? {}
          : { endReadingId: payload.outgoingReading.readingId }),
      })
      .where(
        and(
          eq(activityAssetSegments.workspaceId, ctx.workspaceId),
          eq(activityAssetSegments.id, outgoing.id),
        ),
      );

    await tx.insert(activityAssetSegments).values({
      id: payload.newSegmentId,
      workspaceId: ctx.workspaceId,
      activityId: payload.activityId,
      assetId: payload.substituteAssetId,
      role: "SUBSTITUTE",
      substitutesSegmentId: outgoing.id,
      startedAt: handoverAt,
      ...(payload.incomingReading === undefined
        ? {}
        : { startReadingId: payload.incomingReading.readingId }),
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "activity.asset_substituted",
      entityType: "activity",
      entityId: payload.activityId,
      beforeState: {
        outgoingSegmentId: outgoing.id,
        outgoingAssetId: outgoing.assetId,
        outgoingEndedAt: null,
        outgoingRowVersion: outgoing.rowVersion,
      },
      afterState: {
        outgoingSegmentId: outgoing.id,
        outgoingAssetId: outgoing.assetId,
        outgoingEndedAt: handoverAt.toISOString(),
        outgoingRowVersion: outgoing.rowVersion + 1,
        newSegmentId: payload.newSegmentId,
        substituteAssetId: payload.substituteAssetId,
        role: "SUBSTITUTE",
        startedAt: handoverAt.toISOString(),
        outgoingReadingId: payload.outgoingReading?.readingId ?? null,
        incomingReadingId: payload.incomingReading?.readingId ?? null,
        reason: payload.reason ?? null,
      },
      changedFields: [
        "outgoingSegmentId",
        "outgoingAssetId",
        "outgoingEndedAt",
        "outgoingRowVersion",
        "newSegmentId",
        "substituteAssetId",
        "role",
        "startedAt",
        "outgoingReadingId",
        "incomingReadingId",
        "reason",
      ],
    });

    return { recordId: payload.newSegmentId, rowVersion: 1 };
  },
};

registerCommand(substituteAsset);
