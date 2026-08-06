import { eq, inArray, type SQL } from "drizzle-orm";
import type { AuthContext } from "../auth/types.js";
import { financialEntries } from "../db/schema.js";

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
