import type { ApprovalChain, ApprovalChainStep } from "@routiq/contracts";
import type { TFunction } from "i18next";
import { formatMoney } from "../lib/format.js";

/** "Up to FCFA 150,000: posts directly", one band of the member's chain. */
export function stepText(
  t: TFunction,
  steps: readonly ApprovalChainStep[],
  index: number,
  currency: string,
): string {
  const step = steps[index];
  if (step === undefined) return "";
  const below = index > 0 ? steps[index - 1]?.upToMinor : null;
  const bound = step.upToMinor !== null ? "upTo" : below != null ? "above" : "any";
  const amount = formatMoney(step.upToMinor ?? below ?? null, { currency });
  return t("approvalRules.step", { bound, amount, outcome: step.outcome });
}

/** The rule beside the amount field: the band above which this entry waits, and for whom. */
export function ruleHint(t: TFunction, chain: ApprovalChain, currency: string): string {
  const waitsAt = chain.steps.findIndex((step) => step.outcome !== "POSTS_DIRECTLY");
  if (waitsAt === -1) return t("approvalRules.hint.posts");
  const approver = chain.steps[waitsAt]?.outcome;
  const below = chain.steps[waitsAt - 1]?.upToMinor;
  if (below == null) return t("approvalRules.hint.always", { approver });
  return t("approvalRules.hint.above", { amount: formatMoney(below, { currency }), approver });
}
