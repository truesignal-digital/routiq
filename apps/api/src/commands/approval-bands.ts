import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { approvalRules } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

type ApprovalRuleRow = typeof approvalRules.$inferSelect;

/** The command types whose band is the recording threshold: up to it, an entry posts. */
export const RECORDING_BAND_TYPES = ["record-expense", "record-revenue"] as const;
/** The command types whose band is the Finance ceiling: up to it, Finance decides. */
export const CEILING_BAND_TYPES = ["approve-entry", "reject-entry"] as const;

export interface ApprovalBands {
  rows: ApprovalRuleRow[];
  recordingThresholdMinor: bigint | null;
  financeCeilingMinor: bigint | null;
  /**
   * The bands' version for optimistic concurrency: the sum of the banded
   * rules' row versions. Every band move bumps at least one of them and rules
   * are never deleted outside migrations, so the sum only grows.
   */
  version: number;
}

function lowest(rows: readonly ApprovalRuleRow[], commandTypes: readonly string[]): bigint | null {
  let min: bigint | null = null;
  for (const row of rows) {
    if (!commandTypes.includes(row.commandType) || row.amountMaxMinor === null) continue;
    if (min === null || row.amountMaxMinor < min) min = row.amountMaxMinor;
  }
  return min;
}

/**
 * The workspace-wide bands of the money chain (#354): rules with an upper
 * bound and no branch, category or lower bound, the ones
 * `update-approval-threshold` moves. A rule kept to a branch or a category is
 * a tenant's exception and keeps its own amount.
 */
export async function loadApprovalBands(tx: TenantTx, workspaceId: string): Promise<ApprovalBands> {
  const rows = await tx
    .select()
    .from(approvalRules)
    .where(
      and(
        eq(approvalRules.workspaceId, workspaceId),
        inArray(approvalRules.commandType, [...RECORDING_BAND_TYPES, ...CEILING_BAND_TYPES]),
        isNull(approvalRules.categoryCode),
        isNull(approvalRules.branchId),
        isNull(approvalRules.amountMinMinor),
        isNotNull(approvalRules.amountMaxMinor),
      ),
    );
  return {
    rows,
    recordingThresholdMinor: lowest(rows, RECORDING_BAND_TYPES),
    financeCeilingMinor: lowest(rows, ["approve-entry"]),
    version: rows.reduce((sum, row) => sum + row.rowVersion, 0),
  };
}
