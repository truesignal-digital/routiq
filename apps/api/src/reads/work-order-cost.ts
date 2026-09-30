import { sql, type SQL } from "drizzle-orm";
import { financialEntries, financialPostings, workOrders } from "../db/schema.js";

/**
 * A work order's actual cost (#81): the sum of its non-rejected cost lines —
 * POSTED, SUBMITTED and both halves of a reversal, signed so a reversal pair
 * nets to zero. Derived on every read, never stored, so the order and the books
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
      and ${financialEntries.status} in ('POSTED', 'REVERSED', 'SUBMITTED')
  ) end`;
}

/** The derived cost as a bigint, for the serializers. */
export function parseActualCost(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}
