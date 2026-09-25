import { releaseAssetToServicePayload } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import {
  assetAvailabilityIntervals,
  operationalIssues,
  workOrders,
} from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import {
  actorsForEvents,
  ISSUE_CLOSURE_EVENTS,
  loadWorkOrderForUpdate,
  openAvailabilityInterval,
  requireAsset,
  WORK_ORDER_COMPLETION_EVENTS,
  type WorkOrderRow,
} from "./work-order-lookup.js";

type ReleaseAssetToServicePayload = z.infer<typeof releaseAssetToServicePayload>;

/**
 * Remise en service: the decision that puts a grounded asset back on the road.
 *
 * Never queueable (§6) and never AI (§5.1): every other maintenance command
 * records something that already happened, this one authorizes something that
 * has not, on the one command where being wrong puts an unsafe truck in
 * traffic. The dispatcher refuses any principal but a HUMAN before this runs.
 *
 * The guard starts from what grounded the asset, never from what the client
 * cites (#47 finding 1): the open interval, the signalement that opened it, and
 * a COMPLETED work order answering that signalement. A cited work order must be
 * one of those. Without one, only an explicit override reason on a signalement
 * already closed — resolved on the spot or dismissed — lets the release
 * through, because then a human has already asserted the fault is gone.
 *
 * Closing the interval is the whole write: availability is derived from open
 * intervals, never stored on the asset, and the signalement's status is not
 * touched (#28 — release and resolution are decoupled). Lifecycle status is
 * untouched too — the truck never stopped being IN_SERVICE (§3.4).
 */
export const releaseAssetToService: CommandDefinition<ReleaseAssetToServicePayload> =
  {
    name: "release-asset-to-service",
    version: 1,
    module: "MAINTENANCE",
    allowedRoles: ["ADMIN", "OPS_MANAGER"],
    requiresHumanPrincipal: true,
    payloadSchema: releaseAssetToServicePayload,
    operationalAssetId: (payload) => payload.assetId,
    branchAuthorization: {
      kind: "branches",
      resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
    },

    async execute(tx, ctx, envelope, payload) {
      await requireAsset(tx, ctx, payload.assetId);

      const interval = await openAvailabilityInterval(tx, ctx, payload.assetId, {
        forUpdate: true,
      });
      if (!interval) {
        throw new CommandError(409, "ASSET_NOT_UNAVAILABLE", {
          assetId: payload.assetId,
        });
      }

      const [issue] = await tx
        .select()
        .from(operationalIssues)
        .where(
          and(
            eq(operationalIssues.workspaceId, ctx.workspaceId),
            eq(operationalIssues.id, interval.openedByIssueId),
          ),
        )
        .for("update");
      // The composite FK makes this unreachable; a missing row is a broken
      // database, not a client error, and must not fall through to a release.
      if (!issue) throw new Error("availability interval without its opening issue");

      let citedOrder: WorkOrderRow | undefined;
      if (payload.workOrderId !== undefined) {
        citedOrder = await loadWorkOrderForUpdate(tx, ctx, payload.workOrderId);
        if (citedOrder.assetId !== payload.assetId) {
          throw new CommandError(422, "WORK_ORDER_ASSET_MISMATCH", {
            workOrderId: citedOrder.id,
            workOrderAssetId: citedOrder.assetId,
            assetId: payload.assetId,
          });
        }
        if (citedOrder.issueId !== issue.id) {
          throw new CommandError(422, "WORK_ORDER_ISSUE_MISMATCH", {
            workOrderId: citedOrder.id,
            workOrderIssueId: citedOrder.issueId,
            groundingIssueId: issue.id,
          });
        }
        if (citedOrder.status !== "COMPLETED") {
          throw new CommandError(409, "WORK_ORDER_NOT_COMPLETED", {
            workOrderId: citedOrder.id,
            status: citedOrder.status,
          });
        }
      }

      /**
       * The version quoted is the record the client acted from: the cited
       * work order, else the grounding signalement — which is what a release
       * from the issue row, on the override path, is looking at.
       */
      const quotedRow = citedOrder ?? issue;
      if (
        envelope.expectedVersion !== undefined &&
        envelope.expectedVersion !== quotedRow.rowVersion
      ) {
        throw new CommandError(409, "VERSION_CONFLICT", {
          expectedVersion: envelope.expectedVersion,
          currentVersion: quotedRow.rowVersion,
        });
      }

      const completedOrders = await tx
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.workspaceId, ctx.workspaceId),
            eq(workOrders.issueId, issue.id),
            eq(workOrders.status, "COMPLETED"),
          ),
        );

      const overrideAllowed = issue.status !== "OPEN";
      const releasedOnOverride = completedOrders.length === 0;
      if (releasedOnOverride && (!overrideAllowed || payload.overrideReason === undefined)) {
        throw new CommandError(409, "WORK_ORDER_NOT_COMPLETED", {
          assetId: payload.assetId,
          issueId: issue.id,
          issueStatus: issue.status,
          overrideAllowed,
        });
      }

      /**
       * Releaser ≠ whoever vouched the fault is gone, after a safety-critical
       * report: every member who declared work on this grounding complete, or —
       * on the override path, where no work order vouches — whoever closed the
       * signalement. Strict on purpose: citing a colleague's order does not
       * make a completer a second pair of eyes on their own repair.
       */
      if (issue.safetyCritical) {
        const vouchers = releasedOnOverride
          ? await actorsForEvents(tx, ctx, "operational_issue", [issue.id], ISSUE_CLOSURE_EVENTS)
          : await actorsForEvents(
              tx,
              ctx,
              "work_order",
              completedOrders.map((order) => order.id),
              WORK_ORDER_COMPLETION_EVENTS,
            );
        if (vouchers.has(ctx.principalId)) {
          throw new CommandError(403, "SELF_RELEASE_FORBIDDEN", {
            issueId: issue.id,
            ...(citedOrder === undefined ? {} : { workOrderId: citedOrder.id }),
          });
        }
      }

      const closedAt = new Date();
      const rowVersion = interval.rowVersion + 1;

      await tx
        .update(assetAvailabilityIntervals)
        .set({
          closedAt,
          closedByCommandId: envelope.commandId,
          rowVersion,
        })
        .where(
          and(
            eq(assetAvailabilityIntervals.workspaceId, ctx.workspaceId),
            eq(assetAvailabilityIntervals.id, interval.id),
          ),
        );

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "asset_availability.closed",
        entityType: "asset_availability_interval",
        entityId: interval.id,
        beforeState: {
          closedAt: null,
          closedByCommandId: null,
          rowVersion: interval.rowVersion,
        },
        afterState: {
          closedAt: closedAt.toISOString(),
          closedByCommandId: envelope.commandId,
          rowVersion,
          releaseNote: payload.note ?? null,
          overrideReason: releasedOnOverride ? (payload.overrideReason ?? null) : null,
        },
        changedFields: ["closedAt", "closedByCommandId", "rowVersion"],
      });

      // Second event on the work order that earned the release, so its
      // chronologie shows it beside the completion — without knowing an
      // interval id. The cited order, else the most recently completed one.
      const earningOrder =
        citedOrder ??
        [...completedOrders].sort(
          (left, right) =>
            (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0),
        )[0];
      if (earningOrder) {
        await appendAuditEvent(tx, ctx, envelope, {
          eventType: "work_order.asset_released",
          entityType: "work_order",
          entityId: earningOrder.id,
          afterState: {
            assetId: payload.assetId,
            availabilityIntervalId: interval.id,
            releasedAt: closedAt.toISOString(),
            releaseNote: payload.note ?? null,
          },
          changedFields: [],
        });
      }

      return {
        recordId: interval.id,
        rowVersion,
        recordStatus: "AVAILABLE",
        warnings: [],
      };
    },
  };

registerCommand(releaseAssetToService);
