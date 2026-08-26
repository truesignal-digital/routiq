import {
  approveWorkOrderClosurePayload,
  approveWorkOrderPayload,
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
} from "./work-order-lookup.js";

type ApproveWorkOrderPayload = z.infer<typeof approveWorkOrderPayload>;
type ApproveWorkOrderClosurePayload = z.infer<
  typeof approveWorkOrderClosurePayload
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
 * Authorizes the expected spend on an order a threshold rule held back.
 * SUBMITTED → OPEN, and nobody approves their own request — the same rule
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
    const workOrder = await loadWorkOrderForUpdate(tx, ctx, payload.workOrderId);
    checkOptimisticVersion(envelope, workOrder.rowVersion);

    if (workOrder.status !== "SUBMITTED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: "OPEN",
      });
    }

    const creator = await commandActor(tx, ctx, workOrder.createdByCommandId);
    if (creator === ctx.principalId) {
      throw new CommandError(403, "MAKER_CANNOT_APPROVE");
    }

    const rowVersion = workOrder.rowVersion + 1;
    await tx
      .update(workOrders)
      .set({ status: "OPEN", rowVersion })
      .where(
        and(
          eq(workOrders.workspaceId, ctx.workspaceId),
          eq(workOrders.id, workOrder.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.approved",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: { status: "SUBMITTED", rowVersion: workOrder.rowVersion },
      afterState: {
        status: "OPEN",
        rowVersion,
        approvalNote: payload.note ?? null,
      },
      changedFields: ["status", "rowVersion"],
    });

    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: "OPEN",
      warnings: [],
    };
  },
};

/**
 * Accepts the actual costs the workshop declared. PENDING_CLOSE → CLOSED.
 *
 * The person refused here is the one who DECLARED the completion, not the one
 * who opened the order: what is being checked is the money that was spent, and
 * whoever wrote that number down is the maker of this decision. The completion
 * is found on the audit trail, which stamps its actor in the same transaction
 * as the write — so a completion cannot exist without an author to compare.
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
      const workOrder = await loadWorkOrderForUpdate(
        tx,
        ctx,
        payload.workOrderId,
      );
      checkOptimisticVersion(envelope, workOrder.rowVersion);

      if (workOrder.status !== "PENDING_CLOSE") {
        throw new CommandError(409, "INVALID_STATE_TRANSITION", {
          from: workOrder.status,
          to: "CLOSED",
        });
      }

      const completer = await lastActorForEvents(
        tx,
        ctx,
        workOrder.id,
        WORK_ORDER_COMPLETION_EVENTS,
      );
      if (completer === ctx.principalId) {
        throw new CommandError(403, "MAKER_CANNOT_APPROVE");
      }

      const rowVersion = workOrder.rowVersion + 1;
      await tx
        .update(workOrders)
        .set({ status: "CLOSED", rowVersion })
        .where(
          and(
            eq(workOrders.workspaceId, ctx.workspaceId),
            eq(workOrders.id, workOrder.id),
          ),
        );

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "work_order.closure_approved",
        entityType: "work_order",
        entityId: workOrder.id,
        beforeState: {
          status: "PENDING_CLOSE",
          rowVersion: workOrder.rowVersion,
        },
        afterState: {
          status: "CLOSED",
          rowVersion,
          approvalNote: payload.note ?? null,
        },
        changedFields: ["status", "rowVersion"],
      });

      return {
        recordId: workOrder.id,
        rowVersion,
        recordStatus: "CLOSED",
        warnings: [],
      };
    },
  };

registerCommand(approveWorkOrder);
registerCommand(approveWorkOrderClosure);
