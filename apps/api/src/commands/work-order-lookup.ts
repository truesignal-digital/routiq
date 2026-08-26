import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  assetAvailabilityIntervals,
  assets,
  auditEvents,
  workOrders,
} from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import { CommandError, type CommandContext, type Tx } from "./dispatcher.js";

/**
 * The audit event a completion leaves behind, whichever side of the approval
 * fork it landed on. Two commands read it back to answer "who declared this
 * work finished" — the closure approver and the release, both of which must
 * refuse the same person.
 *
 * Read from the trail rather than from a column on the work order because the
 * trail already records it: `appendAuditEvent` stamps the actor on every event
 * in the same transaction as the write it describes, so a completion cannot
 * commit without leaving its author behind.
 */
export const WORK_ORDER_COMPLETION_EVENTS = [
  "work_order.closure_submitted",
  "work_order.closed",
] as const;

export type WorkOrderRow = typeof workOrders.$inferSelect;

/**
 * The work order a command names, locked for the length of the transaction so
 * two decisions on the same order serialize rather than both reading OPEN.
 */
export async function loadWorkOrderForUpdate(
  tx: Tx,
  ctx: CommandContext,
  workOrderId: string,
): Promise<WorkOrderRow> {
  const [workOrder] = await tx
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.workspaceId, ctx.workspaceId),
        eq(workOrders.id, workOrderId),
      ),
    )
    .for("update");

  if (!workOrder) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "workOrder",
      referenceId: workOrderId,
    });
  }
  return workOrder;
}

/**
 * Branch scope for a command that names a work order rather than an asset. A
 * work order carries no branch of its own — it inherits the branch of the asset
 * in the workshop, which is also where the cost lands.
 */
export async function workOrderBranchIds(
  tx: Tx,
  ctx: CommandContext,
  payload: { workOrderId: string },
): Promise<readonly string[]> {
  const [workOrder] = await tx
    .select({ assetId: workOrders.assetId })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.workspaceId, ctx.workspaceId),
        eq(workOrders.id, payload.workOrderId),
      ),
    )
    .limit(1);
  // A missing work order resolves to no branch, so scope cannot answer 403 for
  // what the handler will report as REFERENCE_NOT_FOUND with the id in it.
  return workOrder ? assetBranchIds(tx, ctx, [workOrder.assetId]) : [];
}

/** The asset a maintenance record is written against; must exist in the workspace. */
export async function requireAsset(
  tx: Tx,
  ctx: CommandContext,
  assetId: string,
): Promise<{ id: string; branchId: string }> {
  const [asset] = await tx
    .select({ id: assets.id, branchId: assets.branchId })
    .from(assets)
    .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, assetId)))
    .limit(1);

  if (!asset) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "asset",
      referenceId: assetId,
    });
  }
  return asset;
}

/** Who last acted on this entity with one of these event types, if anyone. */
export async function lastActorForEvents(
  tx: Tx,
  ctx: CommandContext,
  entityId: string,
  eventTypes: readonly string[],
): Promise<string | undefined> {
  const [event] = await tx
    .select({ actorPrincipalId: auditEvents.actorPrincipalId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, ctx.workspaceId),
        eq(auditEvents.entityType, "work_order"),
        eq(auditEvents.entityId, entityId),
        inArray(auditEvents.eventType, [...eventTypes]),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(1);
  return event?.actorPrincipalId;
}

/** The asset's open availability interval, locked, or undefined when it is available. */
export async function openAvailabilityInterval(
  tx: Tx,
  ctx: CommandContext,
  assetId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<typeof assetAvailabilityIntervals.$inferSelect | undefined> {
  const query = tx
    .select()
    .from(assetAvailabilityIntervals)
    .where(
      and(
        eq(assetAvailabilityIntervals.workspaceId, ctx.workspaceId),
        eq(assetAvailabilityIntervals.assetId, assetId),
        isNull(assetAvailabilityIntervals.closedAt),
      ),
    )
    .limit(1);
  const [interval] = opts.forUpdate ? await query.for("update") : await query;
  return interval;
}
