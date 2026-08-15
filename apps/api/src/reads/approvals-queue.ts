import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { AuthContext } from "../auth/types.js";
import { financialEntries } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/**
 * What "waiting for approval" means, in one place: SUBMITTED entries inside the
 * caller's branch scope. `/v1/finance/approvals` lists and totals them and
 * `/v1/dashboard` counts them — a second copy of this predicate is how the
 * dashboard card and the queue end up showing different numbers.
 *
 * Scope comes from the session (ADR-0003). The optional `branchId` is the
 * client's own narrowing, applied on top of that scope and never instead of it.
 */
export function pendingApprovalConditions(
  auth: AuthContext,
  branchId?: string,
): SQL[] {
  const conditions: SQL[] = [
    eq(financialEntries.workspaceId, auth.workspaceId),
    eq(financialEntries.status, "SUBMITTED"),
  ];

  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(financialEntries.branchId, auth.branchScope));
  }
  if (branchId !== undefined) {
    conditions.push(eq(financialEntries.branchId, branchId));
  }

  return conditions;
}

/**
 * How much pending work a `branchId` narrowing leaves out — the complement of
 * the narrowing above, counted. Zero without one: the queue already spans
 * everything the caller can decide.
 *
 * Work outside `auth.branchScope` is never counted. The client could not widen
 * to it, so offering the number would name work it can never reach.
 *
 * The queue read and the dashboard card both call this rather than each running
 * their own count, so the two can never disagree about what the lens hides.
 */
export async function countPendingOutsideBranch(
  tx: TenantTx,
  auth: AuthContext,
  branchId: string | undefined,
): Promise<number> {
  if (branchId === undefined) return 0;

  const [row] = await tx
    .select({ count: sql<number>`count(*)::integer` })
    .from(financialEntries)
    .where(
      and(
        ...pendingApprovalConditions(auth),
        ne(financialEntries.branchId, branchId),
      ),
    );

  return row?.count ?? 0;
}
