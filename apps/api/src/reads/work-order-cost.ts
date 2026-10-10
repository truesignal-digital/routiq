import type { WorkOrderCostToCome } from "@routiq/contracts";
import { sql, type SQL } from "drizzle-orm";
import { financialEntries, financialPostings, workOrders } from "../db/schema.js";
import { serializeMinor } from "./serialize-minor.js";

/**
 * A work order's actual cost (#81): the sum of its non-rejected cost lines —
 * expense postings, POSTED, SUBMITTED and both halves of a reversal, signed so
 * a reversal pair nets to zero. Revenue naming the order (#432) is no cost. Derived on every read, never stored, so the order and the books
 * cannot disagree. NULL until the work is declared complete: an open order has
 * costs so far, not a cost.
 *
 * Every posting on the order counts, whatever branch its entry was booked to;
 * the same rule as `workOrderLedgerTotal`, which the completion band reads.
 * Correlates on the unaliased `work_orders` of the outer query. Text, so a
 * bigint sum never passes through a JS number on the way out.
 */
export function workOrderActualCostSql(): SQL<string | null> {
  return sql<string | null>`case when ${workOrders.completedAt} is null then null else (
    select coalesce(sum(${financialPostings.amountMinor}), 0)::text
    from ${financialPostings}
    inner join ${financialEntries}
      on ${financialEntries.workspaceId} = ${financialPostings.workspaceId}
      and ${financialEntries.id} = ${financialPostings.financialEntryId}
    where ${financialPostings.workspaceId} = ${workOrders.workspaceId}
      and ${financialPostings.workOrderId} = ${workOrders.id}
      and ${financialPostings.direction} = 'EXPENSE'
      and ${financialEntries.status} in ('POSTED', 'REVERSED', 'SUBMITTED')
  ) end`;
}

/** The derived cost as a bigint, for the serializers. */
export function parseActualCost(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

/**
 * The signed sum of the order's approved cost lines: expense postings whose
 * entry is POSTED or REVERSED, so a reversal pair nets to zero. With
 * `sinceClose`, only entries recorded at or after the order's completion: the
 * invoice that arrived late (#82). Text, like the actual cost.
 */
function approvedCostSql(sinceClose: boolean): SQL<string> {
  return sql<string>`(
    select coalesce(sum(${financialPostings.amountMinor}), 0)::text
    from ${financialPostings}
    inner join ${financialEntries}
      on ${financialEntries.workspaceId} = ${financialPostings.workspaceId}
      and ${financialEntries.id} = ${financialPostings.financialEntryId}
    where ${financialPostings.workspaceId} = ${workOrders.workspaceId}
      and ${financialPostings.workOrderId} = ${workOrders.id}
      and ${financialPostings.direction} = 'EXPENSE'
      and ${financialEntries.status} in ('POSTED', 'REVERSED')
      ${sinceClose ? sql`and ${financialEntries.createdAt} >= ${workOrders.completedAt}` : sql``}
  )`;
}

/**
 * Whether a cost line on the order waits for review; with `sinceClose`, only
 * one recorded at or after the completion.
 */
function pendingCostSql(sinceClose: boolean): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
    from ${financialPostings}
    inner join ${financialEntries}
      on ${financialEntries.workspaceId} = ${financialPostings.workspaceId}
      and ${financialEntries.id} = ${financialPostings.financialEntryId}
    where ${financialPostings.workspaceId} = ${workOrders.workspaceId}
      and ${financialPostings.workOrderId} = ${workOrders.id}
      and ${financialPostings.direction} = 'EXPENSE'
      and ${financialEntries.status} = 'SUBMITTED'
      ${sinceClose ? sql`and ${financialEntries.createdAt} >= ${workOrders.completedAt}` : sql``}
  )`;
}

/**
 * The derived columns `costToCome` reads besides the order's own status,
 * cost outcome and declared cost, for a select over `work_orders`. Correlates
 * on the unaliased table, like `workOrderActualCostSql`.
 */
export function workOrderCostToComeColumns() {
  return {
    approvedCostMinor: approvedCostSql(false),
    approvedSinceCloseMinor: approvedCostSql(true),
    hasPendingCost: pendingCostSql(false),
    hasPendingSinceClose: pendingCostSql(true),
  };
}

export interface CostToComeFacts {
  status: string;
  costOutcome: string | null;
  declaredCostMinor: bigint | null;
  approvedCostMinor: string;
  approvedSinceCloseMinor: string;
  hasPendingCost: boolean;
  hasPendingSinceClose: boolean;
}

/**
 * Whether a completed order still has cost to come (#82), from the facts
 * `workOrderCostToComeColumns` selects. Only approved lines settle it: the
 * invoice is in once Finance has approved it.
 */
export function costToCome(facts: CostToComeFacts): WorkOrderCostToCome | null {
  if (facts.status !== "COMPLETED") return null;
  if (facts.costOutcome === "INVOICE_PENDING") {
    return BigInt(facts.approvedSinceCloseMinor) > 0n
      ? null
      : // A line pending from before the close is not the invoice the close awaits.
        { reason: "INVOICE_PENDING", awaitingApproval: facts.hasPendingSinceClose };
  }
  const recorded = BigInt(facts.approvedCostMinor);
  if (facts.declaredCostMinor !== null && facts.declaredCostMinor > recorded) {
    return {
      reason: "DECLARED_NOT_RECORDED",
      declaredCostMinor: serializeMinor(facts.declaredCostMinor),
      recordedCostMinor: serializeMinor(recorded),
      awaitingApproval: facts.hasPendingCost,
    };
  }
  return null;
}
