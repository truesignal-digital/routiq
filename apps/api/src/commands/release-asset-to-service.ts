import { releaseAssetToServicePayload } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import {
  assetAvailabilityIntervals,
  operationalIssues,
} from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import {
  lastActorForEvents,
  loadWorkOrderForUpdate,
  openAvailabilityInterval,
  requireAsset,
  WORK_ORDER_COMPLETION_EVENTS,
} from "./work-order-lookup.js";

type ReleaseAssetToServicePayload = z.infer<typeof releaseAssetToServicePayload>;

/**
 * Remise en service: the decision that puts a grounded asset back on the road.
 *
 * Never queueable (§6) — every other maintenance command records something that
 * already happened, this one authorizes something that has not. A release
 * replayed from an outbox would be a judgement made against state the device
 * never saw, on the one command where being wrong puts an unsafe truck in
 * traffic.
 *
 * Closing the availability interval is the whole write: availability is derived
 * from open intervals, never stored on the asset, so there is nothing else to
 * flip. Lifecycle status is untouched — the truck never stopped being IN_SERVICE
 * (§3.4).
 */
export const releaseAssetToService: CommandDefinition<ReleaseAssetToServicePayload> =
  {
    name: "release-asset-to-service",
    version: 1,
    module: "MAINTENANCE",
    allowedRoles: ["ADMIN", "OPS_MANAGER"],
    payloadSchema: releaseAssetToServicePayload,
    operationalAssetId: (payload) => payload.assetId,
    branchAuthorization: {
      kind: "branches",
      resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
    },

    async execute(tx, ctx, envelope, payload) {
      await requireAsset(tx, ctx, payload.assetId);
      const workOrder = await loadWorkOrderForUpdate(
        tx,
        ctx,
        payload.workOrderId,
      );

      if (workOrder.assetId !== payload.assetId) {
        throw new CommandError(422, "WORK_ORDER_ASSET_MISMATCH", {
          workOrderId: workOrder.id,
          workOrderAssetId: workOrder.assetId,
          assetId: payload.assetId,
        });
      }

      /**
       * Only a CLOSED order releases. PENDING_CLOSE is not close enough: the
       * declared repair costs are exactly what nobody has accepted yet, and
       * letting the truck out on an unapproved closure would make the approval
       * a formality collected after the risk was already taken.
       *
       * Not INVALID_STATE_TRANSITION, because nothing about the work order is
       * transitioning here — the release is a decision about the asset that
       * reads the order as a precondition.
       */
      if (workOrder.status !== "CLOSED") {
        throw new CommandError(409, "WORK_ORDER_NOT_CLOSED", {
          workOrderId: workOrder.id,
          status: workOrder.status,
        });
      }

      /**
       * The version the client holds is the work order's — the row the
       * maintenance screen lists. The interval it actually closes is a row the
       * client never sees, so it is not what optimistic concurrency can be
       * stated over. Optional rather than required: unlike the work-order
       * mutations, this command does not rewrite the row whose version is
       * quoted.
       */
      if (
        envelope.expectedVersion !== undefined &&
        envelope.expectedVersion !== workOrder.rowVersion
      ) {
        throw new CommandError(409, "VERSION_CONFLICT", {
          expectedVersion: envelope.expectedVersion,
          currentVersion: workOrder.rowVersion,
        });
      }

      const interval = await openAvailabilityInterval(tx, ctx, payload.assetId, {
        forUpdate: true,
      });
      if (!interval) {
        throw new CommandError(409, "ASSET_NOT_UNAVAILABLE", {
          assetId: payload.assetId,
        });
      }

      /**
       * Releaser ≠ performer, but only on work that started with a
       * safety-critical signalement. A preventive service or a cosmetic repair
       * is the mechanic's own call; a truck flagged unsafe needs someone other
       * than the person who declared it fixed to say it may carry passengers.
       *
       * Read from the WORK ORDER's linked issue rather than from the interval's
       * opening issue: an interval only ever opens on a safety-critical report,
       * so testing that one would make the rule unconditional and quietly
       * ground every release behind a second signature.
       */
      if (workOrder.issueId !== null) {
        const [issue] = await tx
          .select({ safetyCritical: operationalIssues.safetyCritical })
          .from(operationalIssues)
          .where(
            and(
              eq(operationalIssues.workspaceId, ctx.workspaceId),
              eq(operationalIssues.id, workOrder.issueId),
            ),
          )
          .limit(1);

        if (issue?.safetyCritical === true) {
          const completer = await lastActorForEvents(
            tx,
            ctx,
            workOrder.id,
            WORK_ORDER_COMPLETION_EVENTS,
          );
          if (completer === ctx.principalId) {
            throw new CommandError(403, "SELF_RELEASE_FORBIDDEN", {
              workOrderId: workOrder.id,
            });
          }
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
        },
        changedFields: ["closedAt", "closedByCommandId", "rowVersion"],
      });

      // Second event on the work order itself, so the chronologie — which reads
      // the trail by work order — shows the release beside the closure that
      // earned it, without having to know an interval id.
      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "work_order.asset_released",
        entityType: "work_order",
        entityId: workOrder.id,
        afterState: {
          assetId: payload.assetId,
          availabilityIntervalId: interval.id,
          releasedAt: closedAt.toISOString(),
          releaseNote: payload.note ?? null,
        },
        changedFields: [],
      });

      return {
        recordId: interval.id,
        rowVersion,
        recordStatus: "AVAILABLE",
        warnings: [],
      };
    },
  };

registerCommand(releaseAssetToService);
