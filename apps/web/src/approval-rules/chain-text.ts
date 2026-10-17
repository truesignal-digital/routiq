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

/** One band's sentence: who an entry in it waits for, from the amount the band starts above. */
function bandText(t: TFunction, steps: readonly ApprovalChainStep[], index: number, currency: string): string {
  const approver = steps[index]?.outcome;
  const below = steps[index - 1]?.upToMinor;
  if (below == null) return t("approvalRules.hint.always", { approver });
  return t("approvalRules.hint.above", { amount: formatMoney(below, { currency }), approver });
}

/**
 * The rule beside the amount field, one sentence per entry. With an amount
 * typed, the band that amount falls in; before that, every band that waits,
 * so a large amount never reads as the first approver's (#534).
 */
export function ruleHint(
  t: TFunction,
  chain: ApprovalChain,
  currency: string,
  amountMinor: number | null = null,
): string[] {
  const { steps } = chain;
  if (steps.every((step) => step.outcome === "POSTS_DIRECTLY")) return [t("approvalRules.hint.posts")];
  if (amountMinor !== null && amountMinor > 0) {
    const index = steps.findIndex((step) => step.upToMinor === null || amountMinor <= step.upToMinor);
    if (index !== -1) {
      return steps[index]?.outcome === "POSTS_DIRECTLY"
        ? [t("approvalRules.hint.postsAt")]
        : [bandText(t, steps, index, currency)];
    }
  }
  return steps.flatMap((step, index) =>
    step.outcome === "POSTS_DIRECTLY" ? [] : [bandText(t, steps, index, currency)],
  );
}
