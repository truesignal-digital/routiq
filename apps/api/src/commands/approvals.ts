import type { CommandEnvelope } from "@asset/contracts";
import { and, eq } from "drizzle-orm";
import { approvalRules, branches } from "../db/schema.js";
import { CommandError } from "./dispatcher.js";
import type { CommandContext, Tx } from "./dispatcher.js";

export interface ApprovalDecision {
  outcome: "AUTO_APPROVED";
  ruleId: string | null;
}

export interface ApprovalContext {
  branchCode?: string;
  categoryCode?: string;
  amountMinor?: number;
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
 */
export async function evaluateApproval(
  tx: Tx,
  ctx: CommandContext,
  _envelope: CommandEnvelope,
  commandType: string,
  approvalContext: ApprovalContext,
): Promise<ApprovalDecision> {
  const rules = await tx
    .select()
    .from(approvalRules)
    .where(
      and(
        eq(approvalRules.workspaceId, ctx.workspaceId),
        eq(approvalRules.commandType, commandType),
      ),
    );

  if (rules.length === 0) {
    throw new CommandError(403, "APPROVAL_REQUIRED", { commandType });
  }

  let resolvedBranchId: string | undefined;
  if (approvalContext.branchCode) {
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

  const amountMinor = BigInt(approvalContext.amountMinor ?? 0);

  const matchingRules = rules.filter((rule) => {
    if (rule.categoryCode !== null && rule.categoryCode !== approvalContext.categoryCode) {
      return false;
    }

    if (rule.branchId !== null) {
      if (!resolvedBranchId || rule.branchId !== resolvedBranchId) {
        return false;
      }
    }

    if (rule.amountMinMinor !== null && amountMinor < rule.amountMinMinor) return false;
    if (rule.amountMaxMinor !== null && amountMinor > rule.amountMaxMinor) return false;

    return true;
  });

  if (matchingRules.length === 0) {
    throw new CommandError(403, "APPROVAL_REQUIRED", { commandType });
  }

  const maxSpecificity = Math.max(...matchingRules.map(ruleSpecificity));
  const authorizingRule = matchingRules
    .filter((rule) => ruleSpecificity(rule) === maxSpecificity && rule.requiredRole === ctx.role)
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    )[0];

  if (authorizingRule) return { outcome: "AUTO_APPROVED", ruleId: authorizingRule.id };
  throw new CommandError(403, "APPROVAL_REQUIRED", { commandType });
}

function ruleSpecificity(rule: typeof approvalRules.$inferSelect): number {
  return [rule.categoryCode, rule.branchId, rule.amountMinMinor, rule.amountMaxMinor].filter(
    (value) => value !== null,
  ).length;
}
