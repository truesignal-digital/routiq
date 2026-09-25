import {
  cancelWorkOrderPayload,
  completeWorkOrderPayload,
  createWorkOrderPayload,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { operationalIssues, workOrders } from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import {
  loadWorkOrderForUpdate,
  requireAsset,
  workOrderBranchIds,
} from "./work-order-lookup.js";

type CreateWorkOrderPayload = z.infer<typeof createWorkOrderPayload>;
type CompleteWorkOrderPayload = z.infer<typeof completeWorkOrderPayload>;
type CancelWorkOrderPayload = z.infer<typeof cancelWorkOrderPayload>;

/**
 * Ordre de travail: the job the workshop is being asked to do.
 *
 * Runs in SUBMIT approval mode, the same fork the financial entries use (§5.2).
 * With the catalog defaults — which carry no amount bounds — every authorized
 * role's creation is AUTO_APPROVED and lands OPEN, so a workspace that never
 * configures a threshold never meets a pending work order at all. A tenant that
 * adds an amount rule above, say, 500 000 XAF starts seeing SUBMITTED orders
 * there, resolved by approve-work-order.
 *
 * `expectedCostMinor` is what the rules match on, so the threshold is read
 * against the spend being authorized rather than against what it turns out to
 * cost. The declared actual cost gets its own fork at completion.
 */
export const createWorkOrder: CommandDefinition<CreateWorkOrderPayload> = {
  name: "create-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "MAINTENANCE"],
  payloadSchema: createWorkOrderPayload,
  approvalMode: "SUBMIT",
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  /**
   * Amount only. A work order carries no category, and the branch dimension is
   * deliberately left out: it would have to be resolved from the asset on every
   * call to answer a rule shape no tenant configures yet. Add it when one does.
   */
  async approvalContext(_tx, _ctx, payload) {
    return payload.expectedCostMinor === undefined
      ? {}
      : { amountMinor: payload.expectedCostMinor };
  },

  async execute(tx, ctx, envelope, payload, approval) {
    await requireAsset(tx, ctx, payload.assetId);

    if (payload.issueId !== undefined) {
      const [issue] = await tx
        .select({ id: operationalIssues.id, assetId: operationalIssues.assetId })
        .from(operationalIssues)
        .where(
          and(
            eq(operationalIssues.workspaceId, ctx.workspaceId),
            eq(operationalIssues.id, payload.issueId),
          ),
        )
        .limit(1);

      if (!issue) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "operationalIssue",
          referenceId: payload.issueId,
        });
      }
      // The composite tenant FK already keeps both rows in one workspace. That
      // the signalement was reported against THIS truck is a rule only the
      // command layer can hold — and it is the one that decides whether the
      // release later needs a second pair of eyes.
      if (issue.assetId !== payload.assetId) {
        throw new CommandError(422, "ISSUE_ASSET_MISMATCH", {
          issueId: payload.issueId,
          issueAssetId: issue.assetId,
          assetId: payload.assetId,
        });
      }
    }

    const status = approval.outcome === "AUTO_APPROVED" ? "OPEN" : "SUBMITTED";

    await tx.insert(workOrders).values({
      id: payload.workOrderId,
      workspaceId: ctx.workspaceId,
      assetId: payload.assetId,
      ...(payload.issueId === undefined ? {} : { issueId: payload.issueId }),
      description: payload.description,
      status,
      ...(payload.expectedCostMinor === undefined
        ? {}
        : { expectedCostMinor: BigInt(payload.expectedCostMinor) }),
      currency: payload.currency,
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: status === "OPEN" ? "work_order.opened" : "work_order.submitted",
      entityType: "work_order",
      entityId: payload.workOrderId,
      afterState: {
        id: payload.workOrderId,
        assetId: payload.assetId,
        issueId: payload.issueId ?? null,
        description: payload.description,
        status,
        expectedCostMinor: payload.expectedCostMinor ?? null,
        currency: payload.currency,
        rowVersion: 1,
      },
      changedFields: [
        "id",
        "assetId",
        "issueId",
        "description",
        "status",
        "expectedCostMinor",
        "currency",
        "rowVersion",
      ],
    });

    return {
      recordId: payload.workOrderId,
      rowVersion: 1,
      recordStatus: status,
      warnings: [],
    };
  },
};

/**
 * The workshop declaring the job finished and what it cost.
 *
 * Same SUBMIT fork as creation, matched on the DECLARED actual cost: under the
 * catalog defaults the order closes in one call, and a tenant threshold sends it
 * to PENDING_CLOSE for approve-work-order-closure to accept. Either way the
 * declared cost, the summary and the completion time are stamped on the row —
 * they are what the approver is being asked to look at, so they cannot wait for
 * the approval that reads them.
 */
export const completeWorkOrder: CommandDefinition<CompleteWorkOrderPayload> = {
  name: "complete-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "MAINTENANCE"],
  payloadSchema: completeWorkOrderPayload,
  approvalMode: "SUBMIT",
  branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

  async approvalContext(_tx, _ctx, payload) {
    return payload.actualCostMinor === undefined
      ? {}
      : { amountMinor: payload.actualCostMinor };
  },

  async execute(tx, ctx, envelope, payload, approval) {
    const workOrder = await loadWorkOrderForUpdate(tx, ctx, payload.workOrderId);
    checkOptimisticVersion(envelope, workOrder.rowVersion);

    const status =
      approval.outcome === "AUTO_APPROVED" ? "CLOSED" : "PENDING_CLOSE";

    if (workOrder.status !== "OPEN") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: status,
      });
    }

    const completedAt = new Date();
    const rowVersion = workOrder.rowVersion + 1;

    await tx
      .update(workOrders)
      .set({
        status,
        // `currency` is deliberately left alone: currencyCode is a literal, so
        // the payload can only ever repeat what the order was created with.
        actualCostMinor:
          payload.actualCostMinor === undefined
            ? null
            : BigInt(payload.actualCostMinor),
        summary: payload.summary ?? null,
        completedAt,
        rowVersion,
      })
      .where(
        and(
          eq(workOrders.workspaceId, ctx.workspaceId),
          eq(workOrders.id, workOrder.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType:
        status === "CLOSED" ? "work_order.closed" : "work_order.closure_submitted",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: workOrder.status,
        actualCostMinor: workOrder.actualCostMinor?.toString() ?? null,
        summary: workOrder.summary,
        completedAt: workOrder.completedAt?.toISOString() ?? null,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status,
        actualCostMinor: payload.actualCostMinor ?? null,
        summary: payload.summary ?? null,
        completedAt: completedAt.toISOString(),
        rowVersion,
      },
      changedFields: [
        "status",
        "actualCostMinor",
        "summary",
        "completedAt",
        "rowVersion",
      ],
    });

    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: status,
      warnings: [],
    };
  },
};

/**
 * Calling the job off. Legal from SUBMITTED (never authorized) and from OPEN
 * (authorized, not done) — never from a terminal state: a closed order is
 * append-only history, and re-cancelling a cancelled one would rewrite the
 * reason the first cancellation recorded. A cancelled order is not deleted; the
 * same signalement can spawn a new one.
 */
export const cancelWorkOrder: CommandDefinition<CancelWorkOrderPayload> = {
  name: "cancel-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "MAINTENANCE"],
  payloadSchema: cancelWorkOrderPayload,
  branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const workOrder = await loadWorkOrderForUpdate(tx, ctx, payload.workOrderId);
    checkOptimisticVersion(envelope, workOrder.rowVersion);

    if (workOrder.status !== "SUBMITTED" && workOrder.status !== "OPEN") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: "CANCELLED",
      });
    }

    const cancelledAt = new Date();
    const rowVersion = workOrder.rowVersion + 1;

    await tx
      .update(workOrders)
      .set({
        status: "CANCELLED",
        cancelReason: payload.reason,
        cancelledAt,
        rowVersion,
      })
      .where(
        and(
          eq(workOrders.workspaceId, ctx.workspaceId),
          eq(workOrders.id, workOrder.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.cancelled",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: workOrder.status,
        cancelReason: workOrder.cancelReason,
        cancelledAt: workOrder.cancelledAt?.toISOString() ?? null,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status: "CANCELLED",
        cancelReason: payload.reason,
        cancelledAt: cancelledAt.toISOString(),
        rowVersion,
      },
      changedFields: ["status", "cancelReason", "cancelledAt", "rowVersion"],
    });

    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: "CANCELLED",
      warnings: [],
    };
  },
};

registerCommand(createWorkOrder);
registerCommand(completeWorkOrder);
registerCommand(cancelWorkOrder);
