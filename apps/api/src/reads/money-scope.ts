import { moneyReadScope } from "@routiq/contracts";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AuthContext } from "../auth/types.js";
import { commands, financialEntries, financialPostings } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/** The columns the money scope reads, on `financial_entries` or an alias of it. */
interface EntryScopeColumns {
  id: AnyPgColumn;
  workspaceId: AnyPgColumn;
  branchId: AnyPgColumn;
  createdByCommandId: AnyPgColumn;
}

/**
 * The entries this caller may read, as a condition on the outer
 * `financial_entries` row: its branch scope, then its money scope
 * (`MONEY_READ_SCOPE`). The ledger and the counter read every entry of their
 * branches; a driver only the entries they recorded; the workshop only entries
 * whose every line is a work-order cost: an expense naming an order. Revenue
 * that named one before #432 refused it is no cost. Which reads serve entries at all is
 * the read's own role gate; this decides which rows. `entries` names an alias
 * when the row is not the outer one, such as an original's cancellation.
 */
export function readableEntrySql(
  auth: AuthContext,
  entries: EntryScopeColumns = financialEntries,
): SQL {
  const conditions: SQL[] = [eq(entries.workspaceId, auth.workspaceId)];
  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(entries.branchId, auth.branchScope));
  }
  const scope = moneyReadScope(auth.role);
  if (scope === "OWN_ENTRIES") {
    // The generated masking column: NULL for PLATFORM receipts, so a vendor
    // operator's entry never matches anyone.
    conditions.push(sql`exists (
      select 1 from ${commands}
      where ${commands.workspaceId} = ${entries.workspaceId}
        and ${commands.id} = ${entries.createdByCommandId}
        and ${commands.tenantActorPrincipalId} = ${auth.principalId}
    )`);
  } else if (scope === "WORK_ORDER_COSTS") {
    conditions.push(sql`not exists (
      select 1 from ${financialPostings}
      where ${financialPostings.workspaceId} = ${entries.workspaceId}
        and ${financialPostings.financialEntryId} = ${entries.id}
        and (${financialPostings.workOrderId} is null or ${financialPostings.direction} <> 'EXPENSE')
    )`);
  }
  return and(...conditions)!;
}

/** Whether the caller may read this one entry: `readableEntrySql` for a single id. */
export async function canReadEntry(
  tx: TenantTx,
  auth: AuthContext,
  entryId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: financialEntries.id })
    .from(financialEntries)
    .where(and(eq(financialEntries.id, entryId), readableEntrySql(auth)))
    .limit(1);
  return row !== undefined;
}
