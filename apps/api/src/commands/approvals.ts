import type { CommandEnvelope, Role } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { approvalRules, branches } from "../db/schema.js";
import type { CommandContext, Tx } from "./dispatcher.js";

export interface ApprovalDecision {
  outcome: "AUTO_APPROVED" | "APPROVAL_REQUIRED";
  ruleId: string | null;
}

const APPROVAL_REQUIRED: ApprovalDecision = { outcome: "APPROVAL_REQUIRED", ruleId: null };

export interface ApprovalContext {
  branchCode?: string;
  /**
   * For commands whose branch is resolved rather than named — a work order
   * lives in its asset's branch. Takes precedence over `branchCode`.
   */
  branchId?: string;
  categoryCode?: string;
  amountMinor?: number | bigint;
  /**
   * No rule may auto-approve this write, whatever its amount: a repair
   * invoice booked after the work order closed (#82).
   */
  requiresReview?: boolean;
}

/**
 * Evaluate approval for a command against tenant-configured approval rules.
 *
 * Logic:
 * 1. Load rules: SELECT from approval_rules WHERE workspaceId = ctx.workspaceId AND commandType = commandType.
 * 2. A rule MATCHES when every non-null filter matches:
 *    - categoryCode: null=wildcard, else must equal approvalContext.categoryCode
 *    - branchId: null=wildcard, else must equal branch ID resolved from approvalContext.branchCode
 *      (if approvalContext has no branchCode, branch-specific rules do NOT match)
 *    - amount range: amountMinMinor/amountMaxMinor null=open-ended; treat undefined amountMinor as 0;
 *      match when min ≤ amount ≤ max (compare as BigInt)
 * 3. Keep only the most-specific matching rules. This lets a tenant override a
 *    broad catalog default with a narrower category/branch/amount rule.
 * 4. If one of those rules authorizes the actor's role, auto-approve. Otherwise
 *    require approval. Ties are deterministic by creation time and id.
 *    Safe default = require review.
 *
 * Returns the decision — never throws. The dispatcher decides what
 * APPROVAL_REQUIRED means per command: reject 403 (default) or proceed with a
 * SUBMITTED record (approvalMode 'SUBMIT', financial entries).
 */
export async function evaluateApproval(
  tx: Tx,
  ctx: CommandContext,
  _envelope: CommandEnvelope,
  commandType: string,
  approvalContext: ApprovalContext,
): Promise<ApprovalDecision> {
  if (approvalContext.requiresReview === true) return APPROVAL_REQUIRED;
  const rules = await loadApprovalRules(tx, ctx.workspaceId, commandType);
  if (rules.length === 0) return APPROVAL_REQUIRED;

  let resolvedBranchId: string | undefined = approvalContext.branchId;
  if (resolvedBranchId === undefined && approvalContext.branchCode) {
    const [resolvedBranch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.workspaceId, ctx.workspaceId),
          eq(branches.code, approvalContext.branchCode),
        ),
      )
      .limit(1);
    resolvedBranchId = resolvedBranch?.id;
  }

  return matchApproval(rules, ctx.role, {
    ...approvalContext,
    ...(resolvedBranchId === undefined ? {} : { branchId: resolvedBranchId }),
  });
}

export type ApprovalRuleRow = typeof approvalRules.$inferSelect;

export function loadApprovalRules(
  tx: Tx,
  workspaceId: string,
  commandType: string,
): Promise<ApprovalRuleRow[]> {
  return tx
    .select()
    .from(approvalRules)
    .where(
      and(
        eq(approvalRules.workspaceId, workspaceId),
        eq(approvalRules.commandType, commandType),
      ),
    );
}

/**
 * Steps 2–4 above over rules already loaded, with the branch already resolved
 * to an id. Reads use it to tell a viewer which pending records their role may
 * decide, with the same answer the command would give.
 */
export function matchApproval(
  rules: readonly ApprovalRuleRow[],
  role: Role,
  approvalContext: Omit<ApprovalContext, "branchCode">,
): ApprovalDecision {
  const amountMinor = BigInt(approvalContext.amountMinor ?? 0);

  const matchingRules = rules.filter((rule) => {
    if (rule.categoryCode !== null && rule.categoryCode !== approvalContext.categoryCode) {
      return false;
    }

    if (rule.branchId !== null) {
      if (!approvalContext.branchId || rule.branchId !== approvalContext.branchId) {
        return false;
      }
    }

    if (rule.amountMinMinor !== null && amountMinor < rule.amountMinMinor) return false;
    if (rule.amountMaxMinor !== null && amountMinor > rule.amountMaxMinor) return false;

    return true;
  });

  if (matchingRules.length === 0) return APPROVAL_REQUIRED;

  const maxSpecificity = Math.max(...matchingRules.map(ruleSpecificity));
  const authorizingRule = matchingRules
    .filter((rule) => ruleSpecificity(rule) === maxSpecificity && rule.requiredRole === role)
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    )[0];

  if (authorizingRule) return { outcome: "AUTO_APPROVED", ruleId: authorizingRule.id };
  return APPROVAL_REQUIRED;
}

function ruleSpecificity(rule: ApprovalRuleRow): number {
  return [rule.categoryCode, rule.branchId, rule.amountMinMinor, rule.amountMaxMinor].filter(
    (value) => value !== null,
  ).length;
}
