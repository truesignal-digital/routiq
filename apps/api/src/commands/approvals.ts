import type { CommandEnvelope } from "@asset/contracts";
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
 * STUB (ticket 06): permissive auto-approve until the rule evaluator lands.
 * The real implementation matches approval_rules and throws
 * CommandError(403, "APPROVAL_REQUIRED") when no rule authorizes the actor.
 */
export async function evaluateApproval(
  _tx: Tx,
  _ctx: CommandContext,
  _envelope: CommandEnvelope,
  _commandType: string,
  _approvalContext: ApprovalContext,
): Promise<ApprovalDecision> {
  return { outcome: "AUTO_APPROVED", ruleId: null };
}
