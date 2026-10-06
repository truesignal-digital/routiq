import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  assetAvailabilityIntervals,
  assets,
  auditEvents,
  financialEntries,
  financialPostings,
  operationalIssues,
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
  "work_order.completion_submitted",
  "work_order.completed",
  // Written before #28 renamed the states; a completion declared then still
  // has an author the approver and the releaser must be compared against.
  "work_order.closure_submitted",
  "work_order.closed",
] as const;

/** Who closed a signalement — the other human assertion a release may rest on. */
export const ISSUE_CLOSURE_EVENTS = [
  "operational_issue.resolved",
  "operational_issue.dismissed",
] as const;

export type WorkOrderRow = typeof workOrders.$inferSelect;
export type IssueRow = typeof operationalIssues.$inferSelect;

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
  entityType: "work_order" | "operational_issue" = "work_order",
): Promise<string | undefined> {
  const [event] = await tx
    .select({ actorPrincipalId: auditEvents.actorPrincipalId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, ctx.workspaceId),
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
        inArray(auditEvents.eventType, [...eventTypes]),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(1);
  return event?.actorPrincipalId;
}

/** Everyone who ever acted on these entities with one of these event types. */
export async function actorsForEvents(
  tx: Tx,
  ctx: CommandContext,
  entityType: "work_order" | "operational_issue",
  entityIds: readonly string[],
  eventTypes: readonly string[],
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const rows = await tx
    .select({ actorPrincipalId: auditEvents.actorPrincipalId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, ctx.workspaceId),
        eq(auditEvents.entityType, entityType),
        inArray(auditEvents.entityId, [...entityIds]),
        inArray(auditEvents.eventType, [...eventTypes]),
      ),
    );
  return new Set(rows.map((row) => row.actorPrincipalId));
}

/** The signalement a command names, locked so a resolve and a dismiss serialize. */
export async function loadIssueForUpdate(
  tx: Tx,
  ctx: CommandContext,
  issueId: string,
): Promise<IssueRow> {
  const [issue] = await tx
    .select()
    .from(operationalIssues)
    .where(
      and(
        eq(operationalIssues.workspaceId, ctx.workspaceId),
        eq(operationalIssues.id, issueId),
      ),
    )
    .for("update");

  if (!issue) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "operationalIssue",
      referenceId: issueId,
    });
  }
  return issue;
}

/** Branch scope for a command that names a signalement: its asset's branch. */
export async function issueBranchIds(
  tx: Tx,
  ctx: CommandContext,
  payload: { issueId: string },
): Promise<readonly string[]> {
  const [issue] = await tx
    .select({ assetId: operationalIssues.assetId })
    .from(operationalIssues)
    .where(
      and(
        eq(operationalIssues.workspaceId, ctx.workspaceId),
        eq(operationalIssues.id, payload.issueId),
      ),
    )
    .limit(1);
  return issue ? assetBranchIds(tx, ctx, [issue.assetId]) : [];
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

/**
 * The work order's asset branch, for approval rules scoped to a branch (#47
 * finding 5). Undefined when the order does not exist; the handler reports that.
 */
export async function workOrderAssetBranchId(
  tx: Tx,
  ctx: CommandContext,
  workOrderId: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ branchId: assets.branchId })
    .from(workOrders)
    .innerJoin(
      assets,
      and(eq(assets.workspaceId, workOrders.workspaceId), eq(assets.id, workOrders.assetId)),
    )
    .where(and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrderId)))
    .limit(1);
  return row?.branchId;
}

/**
 * What the ledger says this repair cost: every expense posting attributed to
 * the order whose entry is POSTED, REVERSED or still SUBMITTED, signed, so a
 * reversal pair nets to zero. Revenue naming an order, written before #432
 * refused it, is not a cost. REJECTED spend never happened. Pending lines are included on
 * purpose — the completion band is a ceiling, and a cost awaiting review is
 * still a cost the approver should see before the job closes.
 */
export async function workOrderLedgerTotal(
  tx: Tx,
  ctx: CommandContext,
  workOrderId: string,
): Promise<bigint> {
  const [row] = await tx
    .select({
      total: sql<string | null>`sum(${financialPostings.amountMinor})`,
    })
    .from(financialPostings)
    .innerJoin(
      financialEntries,
      and(
        eq(financialEntries.workspaceId, financialPostings.workspaceId),
        eq(financialEntries.id, financialPostings.financialEntryId),
      ),
    )
    .where(
      and(
        eq(financialPostings.workspaceId, ctx.workspaceId),
        eq(financialPostings.workOrderId, workOrderId),
        eq(financialPostings.direction, "EXPENSE"),
        inArray(financialEntries.status, ["POSTED", "REVERSED", "SUBMITTED"]),
      ),
    );
  return BigInt(row?.total ?? 0);
}
