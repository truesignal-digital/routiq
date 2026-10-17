import type { ApprovalChainCommandType } from "@routiq/contracts";
import { useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormDescription, useFormField } from "@/components/ui/form";
import { parseWholeAmount } from "../lib/format.js";
import { ruleHint } from "./chain-text.js";
import { useApprovalChain } from "./useApprovalChain.js";

/**
 * The approval rule at the moment it matters (#422): under the amount field it
 * sits in, who the member's own entry waits for at the amount typed, or every
 * band that waits before one is (#534). Nothing while the rules are unknown; a
 * guess would be worse than silence.
 */
export function RuleHint({ commandType }: { commandType: ApprovalChainCommandType }) {
  const { t } = useTranslation();
  const { data } = useApprovalChain();
  const { name } = useFormField();
  const typed: unknown = useWatch({ name });
  const chain = data?.chains.find((candidate) => candidate.commandType === commandType);
  if (data === undefined || chain === undefined) return null;
  const amount = typeof typed === "string" ? parseWholeAmount(typed) : undefined;
  const amountMinor = amount?.kind === "amount" ? amount.minor : null;
  return <FormDescription>{ruleHint(t, chain, data.currency, amountMinor).join(" ")}</FormDescription>;
}
