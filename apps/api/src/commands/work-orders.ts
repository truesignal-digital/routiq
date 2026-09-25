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
import { resolveLinkedIssueOnCompletion } from "./issue-decisions.js";
import {
  loadWorkOrderForUpdate,
  requireAsset,
  workOrderAssetBranchId,
  workOrderBranchIds,
  workOrderLedgerTotal,
  type WorkOrderRow,
} from "./work-order-lookup.js";

type CreateWorkOrderPayload = z.infer<typeof createWorkOrderPayload>;
type CompleteWorkOrderPayload = z.infer<typeof completeWorkOrderPayload>;
type CancelWorkOrderPayload = z.infer<typeof cancelWorkOrderPayload>;

/**
 * Ordre de travail: the job the workshop is being asked to do.
 *
 * No DRAFT (#28): the approval rule is read against the EXPECTED cost and the
 * order lands APPROVED — open work, costs may attach — or SUBMITTED for
 * approve-work-order / reject-work-order. With the catalog defaults, which carry
 * no amount bounds, every authorized role's creation lands APPROVED, so a
 * workspace that never configures a threshold never meets a pending order.
 * The asset's branch goes into the rule context, so a branch-scoped threshold
 * matches (#47 finding 5).
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

  async approvalContext(tx, ctx, payload) {
    const [branchId] = await assetBranchIds(tx, ctx, [payload.assetId]);
    return {
      ...(branchId === undefined ? {} : { branchId }),
      ...(payload.expectedCostMinor === undefined
        ? {}
        : { amountMinor: payload.expectedCostMinor }),
    };
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
      // command layer can hold — and it is the one the release reads to decide
      // which completed work answers a grounding.
      if (issue.assetId !== payload.assetId) {
        throw new CommandError(422, "ISSUE_ASSET_MISMATCH", {
          issueId: payload.issueId,
          issueAssetId: issue.assetId,
          assetId: payload.assetId,
        });
      }
    }

    const status = approval.outcome === "AUTO_APPROVED" ? "APPROVED" : "SUBMITTED";

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
      eventType: status === "APPROVED" ? "work_order.created" : "work_order.submitted",
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
 * The workshop declaring the job finished. APPROVED → COMPLETED (auto band) or
 * COMPLETION_SUBMITTED for approve-work-order-closure / reject-work-order-
 * completion.
 *
 * The band is read against the actual total: the larger of what the workshop
 * declares and what the ledger already holds against the order, so a
 * completion cannot slip under a threshold by under-declaring spend the
 * postings already show. The completion facts — cost, summary, time and the
 * resolve flag — are stamped either way: they are what an approver is asked to
 * look at, and a held completion acts on its flag only once approved.
 */
export const completeWorkOrder: CommandDefinition<CompleteWorkOrderPayload> = {
  name: "complete-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "MAINTENANCE"],
  payloadSchema: completeWorkOrderPayload,
  approvalMode: "SUBMIT",
  branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

  async approvalContext(tx, ctx, payload) {
    // Sequential: one transaction owns one connection.
    const branchId = await workOrderAssetBranchId(tx, ctx, payload.workOrderId);
    const ledgerTotal = await workOrderLedgerTotal(tx, ctx, payload.workOrderId);
    const declared = BigInt(payload.actualCostMinor ?? 0);
    const actualTotal = declared > ledgerTotal ? declared : ledgerTotal;
    return {
      ...(branchId === undefined ? {} : { branchId }),
      amountMinor: Number(actualTotal),
    };
  },

  async execute(tx, ctx, envelope, payload, approval) {
    const workOrder = await loadWorkOrderForUpdate(tx, ctx, payload.workOrderId);
    checkOptimisticVersion(envelope, workOrder.rowVersion);

    const status =
      approval.outcome === "AUTO_APPROVED" ? "COMPLETED" : "COMPLETION_SUBMITTED";

    if (workOrder.status !== "APPROVED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: status,
      });
    }

    const resolveLinkedIssue =
      workOrder.issueId !== null && (payload.resolveLinkedIssue ?? true);
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
        resolveLinkedIssue,
        completionRejectReason: null,
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
        status === "COMPLETED" ? "work_order.completed" : "work_order.completion_submitted",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: workOrder.status,
        actualCostMinor: workOrder.actualCostMinor?.toString() ?? null,
        summary: workOrder.summary,
        resolveLinkedIssue: workOrder.resolveLinkedIssue,
        completionRejectReason: workOrder.completionRejectReason,
        completedAt: workOrder.completedAt?.toISOString() ?? null,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status,
        actualCostMinor: payload.actualCostMinor ?? null,
        summary: payload.summary ?? null,
        resolveLinkedIssue,
        completionRejectReason: null,
        completedAt: completedAt.toISOString(),
        rowVersion,
      },
      changedFields: [
        "status",
        "actualCostMinor",
        "summary",
        "resolveLinkedIssue",
        "completionRejectReason",
        "completedAt",
        "rowVersion",
      ],
    });

    if (status === "COMPLETED" && resolveLinkedIssue) {
      await resolveLinkedIssueOnCompletion(
        tx,
        ctx,
        envelope,
        workOrder,
        payload.summary,
      );
    }

    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: status,
      warnings: [],
    };
  },
};

const CANCELLABLE = new Set<WorkOrderRow["status"]>([
  "SUBMITTED",
  "APPROVED",
  "COMPLETION_SUBMITTED",
]);

/**
 * Calling the job off, from any state that is not terminal (#28). Posted costs
 * stand — abandoning a repair does not unspend money — and there is no
 * auto-reversal: correcting them is a finance decision taken by reverse-entry.
 * A terminal order is append-only history, and re-cancelling a cancelled one
 * would rewrite the reason the first cancellation recorded. The same
 * signalement can spawn a new order.
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

    if (!CANCELLABLE.has(workOrder.status)) {
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
