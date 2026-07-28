import {
  closeActivityPayload,
  reopenActivityPayload,
  type CommandWarningCode,
} from "@routiq/contracts";
import { and, count, eq, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  financialEntries,
  financialPostings,
  movementLegs,
} from "../db/schema.js";
import { activityRequirements, evaluateCompleteness } from "./completeness.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";

type CloseActivityPayload = z.infer<typeof closeActivityPayload>;
type ReopenActivityPayload = z.infer<typeof reopenActivityPayload>;

async function activityBranch(
  tx: Tx,
  ctx: CommandContext,
  activityId: string,
): Promise<readonly string[]> {
  const [activity] = await tx
    .select({ branchId: activities.branchId })
    .from(activities)
    .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.id, activityId)))
    .limit(1);
  return activity ? [activity.branchId] : [];
}

const closeActivity: CommandDefinition<CloseActivityPayload> = {
  name: "close-activity",
  version: 1,
  module: "ACTIVITIES",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"],
  payloadSchema: closeActivityPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => activityBranch(tx, ctx, payload.activityId),
  },

  async execute(tx, ctx, envelope, payload) {
    const [activity] = await tx
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.workspaceId, ctx.workspaceId),
          eq(activities.id, payload.activityId),
        ),
      )
      .limit(1)
      .for("update");
    if (!activity) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "activity",
        referenceCode: payload.activityId,
      });
    }
    checkOptimisticVersion(envelope, activity.rowVersion);
    if (activity.status === "CLOSED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        entityType: "activity",
        status: activity.status,
      });
    }

    const endedAt =
      payload.endedAt !== undefined ? new Date(payload.endedAt) : activity.endedAt;

    const segments = await tx
      .select({
        id: activityAssetSegments.id,
        role: activityAssetSegments.role,
        endedAt: activityAssetSegments.endedAt,
        startReadingId: activityAssetSegments.startReadingId,
        endReadingId: activityAssetSegments.endReadingId,
        rowVersion: activityAssetSegments.rowVersion,
      })
      .from(activityAssetSegments)
      .where(
        and(
          eq(activityAssetSegments.workspaceId, ctx.workspaceId),
          eq(activityAssetSegments.activityId, payload.activityId),
        ),
      );

    const [legs] = await tx
      .select({ value: count() })
      .from(movementLegs)
      .where(
        and(
          eq(movementLegs.workspaceId, ctx.workspaceId),
          eq(movementLegs.activityId, payload.activityId),
        ),
      );
    const [crew] = await tx
      .select({ value: count() })
      .from(activityPeople)
      .where(
        and(
          eq(activityPeople.workspaceId, ctx.workspaceId),
          eq(activityPeople.activityId, payload.activityId),
        ),
      );
    // Revenue attributed to this job, in any state a reader would count.
    const [revenue] = await tx
      .select({ value: count() })
      .from(financialPostings)
      .innerJoin(
        financialEntries,
        eq(financialPostings.financialEntryId, financialEntries.id),
      )
      .where(
        and(
          eq(financialPostings.workspaceId, ctx.workspaceId),
          eq(financialPostings.activityId, payload.activityId),
          eq(financialPostings.direction, "REVENUE"),
          or(eq(financialEntries.status, "POSTED"), eq(financialEntries.status, "SUBMITTED")),
        ),
      );

    const verdict = evaluateCompleteness({
      startedAt: activity.startedAt,
      endedAt,
      segments,
      legCount: legs?.value ?? 0,
      crewCount: crew?.value ?? 0,
      revenueEntryCount: revenue?.value ?? 0,
      requirements: activityRequirements(activity.templateCode),
    });

    if (!verdict.closeable) {
      throw new CommandError(422, "ACTIVITY_CLOSE_BLOCKED", { blockedBy: verdict.blockedBy });
    }

    // Dangling carrier segments are stamped rather than left open — an open
    // segment on a closed job would block every future activity for that asset.
    if (endedAt !== null) {
      await tx
        .update(activityAssetSegments)
        .set({ endedAt })
        .where(
          and(
            eq(activityAssetSegments.workspaceId, ctx.workspaceId),
            eq(activityAssetSegments.activityId, payload.activityId),
            isNull(activityAssetSegments.endedAt),
          ),
        );
    }

    const rowVersion = activity.rowVersion + 1;
    await tx
      .update(activities)
      .set({
        status: "CLOSED",
        completeness: verdict.completeness,
        completenessCodes: verdict.codes,
        ...(endedAt === null ? {} : { endedAt }),
        closedAt: new Date(),
        closedByCommandId: envelope.commandId,
        rowVersion,
      })
      .where(
        and(
          eq(activities.workspaceId, ctx.workspaceId),
          eq(activities.id, payload.activityId),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "activity.closed",
      entityType: "activity",
      entityId: payload.activityId,
      beforeState: {
        status: activity.status,
        completeness: activity.completeness,
        completenessCodes: activity.completenessCodes,
        endedAt: activity.endedAt?.toISOString() ?? null,
        rowVersion: activity.rowVersion,
      },
      afterState: {
        status: "CLOSED",
        completeness: verdict.completeness,
        completenessCodes: verdict.codes,
        endedAt: endedAt?.toISOString() ?? null,
        note: payload.note ?? null,
        rowVersion,
      },
      changedFields: [
        "status",
        "completeness",
        "completenessCodes",
        "endedAt",
        "rowVersion",
      ],
    });

    return {
      recordId: payload.activityId,
      rowVersion,
      recordStatus: verdict.completeness,
      warnings: verdict.codes as CommandWarningCode[],
    };
  },
};

/** Split from close because it carries different risk (§5.1 note on dual verbs). */
const reopenActivity: CommandDefinition<ReopenActivityPayload> = {
  name: "reopen-activity",
  version: 1,
  module: "ACTIVITIES",
  // §5.1 gives reopen one approval; realized the way reopen-period already is —
  // a restricted role plus a mandatory reason in the audit trail, not a second
  // approval step (§5.2 keeps approvals single-step).
  allowedRoles: ["ADMIN", "OPS_MANAGER"],
  payloadSchema: reopenActivityPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => activityBranch(tx, ctx, payload.activityId),
  },

  async execute(tx, ctx, envelope, payload) {
    const [activity] = await tx
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.workspaceId, ctx.workspaceId),
          eq(activities.id, payload.activityId),
        ),
      )
      .limit(1)
      .for("update");
    if (!activity) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "activity",
        referenceCode: payload.activityId,
      });
    }
    checkOptimisticVersion(envelope, activity.rowVersion);
    if (activity.status !== "CLOSED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        entityType: "activity",
        status: activity.status,
      });
    }

    const rowVersion = activity.rowVersion + 1;
    // completeness must clear with the status — the CHECK ties them together,
    // and a reopened job has no verdict until it is closed again.
    await tx
      .update(activities)
      .set({
        status: "OPEN",
        completeness: null,
        completenessCodes: [],
        closedAt: null,
        closedByCommandId: null,
        rowVersion,
      })
      .where(
        and(
          eq(activities.workspaceId, ctx.workspaceId),
          eq(activities.id, payload.activityId),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "activity.reopened",
      entityType: "activity",
      entityId: payload.activityId,
      beforeState: {
        status: "CLOSED",
        completeness: activity.completeness,
        completenessCodes: activity.completenessCodes,
        rowVersion: activity.rowVersion,
      },
      afterState: {
        status: "OPEN",
        completeness: null,
        completenessCodes: [],
        reason: payload.reason,
        rowVersion,
      },
      changedFields: ["status", "completeness", "completenessCodes", "rowVersion"],
    });

    return { recordId: payload.activityId, rowVersion, recordStatus: "OPEN" };
  },
};

registerCommand(closeActivity);
registerCommand(reopenActivity);
