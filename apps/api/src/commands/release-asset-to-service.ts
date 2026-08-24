import {
  releaseAssetToServicePayload,
  type CommandWarningCode,
  type ReleaseAssetToServicePayload,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import {
  availabilityIntervals,
  operationalIssues,
  workOrders,
} from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
} from "./dispatcher.js";
import { openAvailabilityInterval } from "./operational-issues.js";

/**
 * Remise en service (§5.1): closes the asset's open UNAVAILABLE interval — and
 * nothing else. Issue state is deliberately untouched (#28); the mismatch in
 * either direction is a warning, never a block. Always one human approval: the
 * command IS the approval act, so its catalog rule authorizes the deciding
 * roles directly, an AI principal is refused outright, and for safety-critical
 * work the releaser must not be the performer who submitted the completion.
 */
registerCommand<ReleaseAssetToServicePayload>({
  name: "release-asset-to-service",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["OPS_MANAGER", "ADMIN"],
  payloadSchema: releaseAssetToServicePayload,
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async execute(tx, ctx, envelope, payload) {
    /*
     * §7.1 / audit #30: releasing an asset back onto the road is a judgement
     * about physical safety — the one command the restricted-principal seam
     * must never authorize, whatever roles a future AI membership carries.
     */
    if (ctx.principalType !== "HUMAN") {
      throw new CommandError(403, "ROLE_FORBIDDEN", {
        command: "release-asset-to-service.v1",
        reason: "HUMAN_PRINCIPAL_REQUIRED",
      });
    }

    const interval = await openAvailabilityInterval(tx, ctx, payload.assetId);
    if (!interval) {
      throw new CommandError(409, "NO_OPEN_UNAVAILABILITY", {
        assetId: payload.assetId,
      });
    }

    checkOptimisticVersion(envelope, interval.rowVersion);

    const warnings: CommandWarningCode[] = [];
    if (interval.openedByIssueId !== null) {
      const [issue] = await tx
        .select({
          id: operationalIssues.id,
          status: operationalIssues.status,
          safetyCritical: operationalIssues.safetyCritical,
        })
        .from(operationalIssues)
        .where(
          and(
            eq(operationalIssues.workspaceId, ctx.workspaceId),
            eq(operationalIssues.id, interval.openedByIssueId),
          ),
        );

      /*
       * Releaser ≠ performer (§5.1, safety-critical work): the performer on
       * record is whoever submitted a completion for a WO on this issue —
       * including one already COMPLETED. A second pair of eyes puts the asset
       * back on the road.
       */
      if (issue?.safetyCritical) {
        const performed = await tx
          .select({ id: workOrders.id })
          .from(workOrders)
          .where(
            and(
              eq(workOrders.workspaceId, ctx.workspaceId),
              eq(workOrders.operationalIssueId, issue.id),
              eq(workOrders.completedByPrincipalId, ctx.principalId),
              inArray(workOrders.status, ["COMPLETION_SUBMITTED", "COMPLETED"]),
            ),
          )
          .limit(1);
        if (performed.length > 0) {
          throw new CommandError(403, "RELEASER_CANNOT_BE_PERFORMER", {
            issueId: issue.id,
            workOrderId: performed[0]!.id,
          });
        }
      }

      if (issue?.status === "OPEN") warnings.push("ASSET_RELEASED_ISSUE_STILL_OPEN");
    }

    const endedAt = payload.releasedAt ? new Date(payload.releasedAt) : new Date();
    if (endedAt.getTime() <= interval.startedAt.getTime()) {
      throw new CommandError(422, "VALIDATION_FAILED", {
        issues: [{ code: "custom", path: ["releasedAt"] }],
        releasedAtBeforeIntervalStart: true,
      });
    }

    const rowVersion = interval.rowVersion + 1;
    await tx
      .update(availabilityIntervals)
      .set({
        endedAt,
        releaseNote: payload.note ?? null,
        releasedByCommandId: envelope.commandId,
        rowVersion,
      })
      .where(
        and(
          eq(availabilityIntervals.workspaceId, ctx.workspaceId),
          eq(availabilityIntervals.id, interval.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "availability_interval.closed",
      entityType: "availability_interval",
      entityId: interval.id,
      beforeState: {
        endedAt: null,
        releaseNote: null,
        releasedByCommandId: null,
        rowVersion: interval.rowVersion,
      },
      afterState: {
        endedAt: endedAt.toISOString(),
        releaseNote: payload.note ?? null,
        releasedByCommandId: envelope.commandId,
        rowVersion,
      },
      changedFields: ["endedAt", "releaseNote", "releasedByCommandId", "rowVersion"],
    });

    return {
      recordId: interval.id,
      rowVersion,
      warnings,
    };
  },
});
