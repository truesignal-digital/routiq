import {
  approveWorkOrderClosurePayload,
  approveWorkOrderPayload,
  rejectWorkOrderCompletionPayload,
  rejectWorkOrderPayload,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { commands, workOrders } from "../db/schema.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";
import {
  lastActorForEvents,
  loadWorkOrderForUpdate,
  workOrderBranchIds,
  WORK_ORDER_COMPLETION_EVENTS,
  type WorkOrderRow,
} from "./work-order-lookup.js";
import { resolveLinkedIssueOnCompletion } from "./issue-decisions.js";

type ApproveWorkOrderPayload = z.infer<typeof approveWorkOrderPayload>;
type ApproveWorkOrderClosurePayload = z.infer<
  typeof approveWorkOrderClosurePayload
>;
type RejectWorkOrderPayload = z.infer<typeof rejectWorkOrderPayload>;
type RejectWorkOrderCompletionPayload = z.infer<
  typeof rejectWorkOrderCompletionPayload
>;

/** The member behind a command receipt, for the maker/checker split. */
async function commandActor(
  tx: Tx,
  ctx: CommandContext,
  commandId: string,
): Promise<string | undefined> {
  const [receipt] = await tx
    .select({ initiatedByPrincipalId: commands.initiatedByPrincipalId })
    .from(commands)
    .where(
      and(eq(commands.workspaceId, ctx.workspaceId), eq(commands.id, commandId)),
    )
    .limit(1);
  return receipt?.initiatedByPrincipalId;
}

/**
 * A pending work order, locked, in the state this decision resolves — and not
 * decided by the member who made it. Creation's maker is whoever asked for the
 * spend; a completion's maker is whoever declared it, found on the audit trail,
 * which stamps its actor in the same transaction as the write — so a
 * completion cannot exist without an author to compare.
 */
async function loadPendingDecision(
  tx: Tx,
  ctx: CommandContext,
  envelope: Parameters<typeof checkOptimisticVersion>[0],
  workOrderId: string,
  pending: "SUBMITTED" | "COMPLETION_SUBMITTED",
  to: WorkOrderRow["status"],
): Promise<WorkOrderRow> {
  const workOrder = await loadWorkOrderForUpdate(tx, ctx, workOrderId);
  checkOptimisticVersion(envelope, workOrder.rowVersion);

  if (workOrder.status !== pending) {
    throw new CommandError(409, "INVALID_STATE_TRANSITION", {
      from: workOrder.status,
      to,
    });
  }

  const maker =
    pending === "SUBMITTED"
      ? await commandActor(tx, ctx, workOrder.createdByCommandId)
      : await lastActorForEvents(tx, ctx, workOrder.id, WORK_ORDER_COMPLETION_EVENTS);
  if (maker === ctx.principalId) {
    throw new CommandError(403, "MAKER_CANNOT_APPROVE");
  }
  return workOrder;
}

async function writeStatus(
  tx: Tx,
  ctx: CommandContext,
  workOrder: WorkOrderRow,
  set: Partial<typeof workOrders.$inferInsert>,
): Promise<number> {
  const rowVersion = workOrder.rowVersion + 1;
  await tx
    .update(workOrders)
    .set({ ...set, rowVersion })
    .where(
      and(
        eq(workOrders.workspaceId, ctx.workspaceId),
        eq(workOrders.id, workOrder.id),
      ),
    );
  return rowVersion;
}

/**
 * Authorizes the expected spend on an order a threshold rule held back.
 * SUBMITTED → APPROVED, and nobody approves their own request — the same rule
 * approve-entry holds, for the same reason: a threshold that the person who
 * tripped it can clear themselves is not a threshold.
 */
export const approveWorkOrder: CommandDefinition<ApproveWorkOrderPayload> = {
  name: "approve-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["FINANCE_APPROVER", "ADMIN"],
  payloadSchema: approveWorkOrderPayload,
  branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const workOrder = await loadPendingDecision(
      tx, ctx, envelope, payload.workOrderId, "SUBMITTED", "APPROVED",
    );
    const rowVersion = await writeStatus(tx, ctx, workOrder, { status: "APPROVED" });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.approved",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: { status: "SUBMITTED", rowVersion: workOrder.rowVersion },
      afterState: {
        status: "APPROVED",
        rowVersion,
        approvalNote: payload.note ?? null,
      },
      changedFields: ["status", "rowVersion"],
    });

    return { recordId: workOrder.id, rowVersion, recordStatus: "APPROVED", warnings: [] };
  },
};

/**
 * Refuses the spend: SUBMITTED → REJECTED, terminal. Same maker/checker split
 * as its approving pair — refusing your own request is as much a decision on it
 * as granting it.
 */
export const rejectWorkOrder: CommandDefinition<RejectWorkOrderPayload> = {
  name: "reject-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["FINANCE_APPROVER", "ADMIN"],
  payloadSchema: rejectWorkOrderPayload,
  branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const workOrder = await loadPendingDecision(
      tx, ctx, envelope, payload.workOrderId, "SUBMITTED", "REJECTED",
    );
    const rejectedAt = new Date();
    const rowVersion = await writeStatus(tx, ctx, workOrder, {
      status: "REJECTED",
      rejectReason: payload.reason,
      rejectedAt,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.rejected",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: "SUBMITTED",
        rejectReason: null,
        rejectedAt: null,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status: "REJECTED",
        rejectReason: payload.reason,
        rejectedAt: rejectedAt.toISOString(),
        rowVersion,
      },
      changedFields: ["status", "rejectReason", "rejectedAt", "rowVersion"],
    });

    return { recordId: workOrder.id, rowVersion, recordStatus: "REJECTED", warnings: [] };
  },
};

/**
 * Accepts the completion the workshop declared: COMPLETION_SUBMITTED →
 * COMPLETED, and — when the completion asked for it — resolves the linked
 * signalement in the same transaction. The person refused here is the one who
 * DECLARED the completion, not the one who opened the order: what is being
 * checked is the money that was spent, and whoever wrote that number down is
 * the maker of this decision.
 */
export const approveWorkOrderClosure: CommandDefinition<ApproveWorkOrderClosurePayload> =
  {
    name: "approve-work-order-closure",
    version: 1,
    module: "MAINTENANCE",
    allowedRoles: ["FINANCE_APPROVER", "ADMIN"],
    payloadSchema: approveWorkOrderClosurePayload,
    branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

    async execute(tx, ctx, envelope, payload) {
      const workOrder = await loadPendingDecision(
        tx, ctx, envelope, payload.workOrderId, "COMPLETION_SUBMITTED", "COMPLETED",
      );
      const rowVersion = await writeStatus(tx, ctx, workOrder, { status: "COMPLETED" });

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "work_order.completion_approved",
        entityType: "work_order",
        entityId: workOrder.id,
        beforeState: {
          status: "COMPLETION_SUBMITTED",
          rowVersion: workOrder.rowVersion,
        },
        afterState: {
          status: "COMPLETED",
          rowVersion,
          approvalNote: payload.note ?? null,
        },
        changedFields: ["status", "rowVersion"],
      });

      if (workOrder.resolveLinkedIssue) {
        await resolveLinkedIssueOnCompletion(tx, ctx, envelope, workOrder, workOrder.summary);
      }

      return { recordId: workOrder.id, rowVersion, recordStatus: "COMPLETED", warnings: [] };
    },
  };

/**
 * Sends a declared completion back: COMPLETION_SUBMITTED → APPROVED. The work
 * stays open — costs can be corrected by reversal and new postings, and the
 * workshop resubmits. The held completion facts are cleared so an APPROVED row
 * never shows a completion nobody accepted; the trail keeps them.
 */
export const rejectWorkOrderCompletion: CommandDefinition<RejectWorkOrderCompletionPayload> =
  {
    name: "reject-work-order-completion",
    version: 1,
    module: "MAINTENANCE",
    allowedRoles: ["FINANCE_APPROVER", "ADMIN"],
    payloadSchema: rejectWorkOrderCompletionPayload,
    branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

    async execute(tx, ctx, envelope, payload) {
      const workOrder = await loadPendingDecision(
        tx, ctx, envelope, payload.workOrderId, "COMPLETION_SUBMITTED", "APPROVED",
      );
      const rowVersion = await writeStatus(tx, ctx, workOrder, {
        status: "APPROVED",
        actualCostMinor: null,
        summary: null,
        resolveLinkedIssue: false,
        completedAt: null,
        completionRejectReason: payload.reason,
      });

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "work_order.completion_rejected",
        entityType: "work_order",
        entityId: workOrder.id,
        beforeState: {
          status: "COMPLETION_SUBMITTED",
          actualCostMinor: workOrder.actualCostMinor?.toString() ?? null,
          summary: workOrder.summary,
          resolveLinkedIssue: workOrder.resolveLinkedIssue,
          completedAt: workOrder.completedAt?.toISOString() ?? null,
          completionRejectReason: workOrder.completionRejectReason,
          rowVersion: workOrder.rowVersion,
        },
        afterState: {
          status: "APPROVED",
          actualCostMinor: null,
          summary: null,
          resolveLinkedIssue: false,
          completedAt: null,
          completionRejectReason: payload.reason,
          rowVersion,
        },
        changedFields: [
          "status",
          "actualCostMinor",
          "summary",
          "resolveLinkedIssue",
          "completedAt",
          "completionRejectReason",
          "rowVersion",
        ],
      });

      return { recordId: workOrder.id, rowVersion, recordStatus: "APPROVED", warnings: [] };
    },
  };

registerCommand(approveWorkOrder);
registerCommand(rejectWorkOrder);
registerCommand(approveWorkOrderClosure);
registerCommand(rejectWorkOrderCompletion);
