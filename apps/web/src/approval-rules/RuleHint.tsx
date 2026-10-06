import type { ApprovalChainCommandType } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { FormDescription } from "@/components/ui/form";
import { ruleHint } from "./chain-text.js";
import { useApprovalChain } from "./useApprovalChain.js";

/**
 * The approval rule at the moment it matters (#422): beside the amount, the
 * band above which the member's own entry waits. Nothing while the rules are
 * unknown; a guess would be worse than silence.
 */
export function RuleHint({ commandType }: { commandType: ApprovalChainCommandType }) {
  const { t } = useTranslation();
  const { data } = useApprovalChain();
  const chain = data?.chains.find((candidate) => candidate.commandType === commandType);
  if (data === undefined || chain === undefined) return null;
  return <FormDescription>{ruleHint(t, chain, data.currency)}</FormDescription>;
}
