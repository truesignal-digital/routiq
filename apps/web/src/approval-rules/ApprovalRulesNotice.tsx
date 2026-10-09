import type { AcknowledgeApprovalRulesPayload } from "@routiq/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { useCommandLabel } from "../commands/labels.js";
import { formatDayLong } from "../lib/format.js";
import { stepText } from "./chain-text.js";
import { approvalChainKey, useApprovalChain } from "./useApprovalChain.js";

/**
 * Tells a member, on their next screen after Direction changed the approval
 * rules, what now happens to their own entries (#422). It stays on every
 * screen until they acknowledge it; the acknowledgement is a command, so it
 * holds on every device. Only the latest change shows: the rules as they are.
 */
export function ApprovalRulesNotice({ client = commandClient }: { client?: CommandClient }) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const { data } = useApprovalChain();
  const intent = useRef<CommandIntent<AcknowledgeApprovalRulesPayload> | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [acknowledgedId, setAcknowledgedId] = useState<string | undefined>(undefined);

  const notice = data?.notice;
  if (data === undefined || notice == null || notice.changeId === acknowledgedId) return null;
  const { changeId } = notice;

  async function acknowledge() {
    setSubmitting(true);
    setFailed(false);
    intent.current ??= createCommandIntent<AcknowledgeApprovalRulesPayload>(
      client,
      "acknowledge-approval-rules",
      1,
    );
    const result = await intent.current.submit({ changeId });
    setSubmitting(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setAcknowledgedId(changeId);
    void queryClient.invalidateQueries({ queryKey: approvalChainKey(session?.workspaceSlug) });
  }

  const date = formatDayLong(notice.changedAt);

  return (
    <div className="mb-6">
      <Alert role="status" aria-live="polite" data-slot="approval-rules-notice">
        <Scale aria-hidden />
        <AlertTitle>{t("approvalRules.notice.title")}</AlertTitle>
        <AlertDescription className="flex flex-col gap-3 [&_p:not(:last-child)]:mb-0">
          <p>
            {notice.changedBy === null
              ? t("approvalRules.notice.changedByRoutiq", { date })
              : t("approvalRules.notice.changedBy", { name: notice.changedBy, date })}
          </p>
          {data.chains.map((chain) => (
            <div key={chain.commandType} className="flex flex-col gap-1">
              <p className="font-medium text-foreground">
                {t(`approvalRules.chain.${chain.commandType}`)}
              </p>
              <ul className="flex flex-col gap-0.5">
                {chain.steps.map((step, index) => (
                  <li key={`${step.outcome}-${step.upToMinor ?? "above"}`}>
                    {stepText(t, chain.steps, index, data.currency)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {failed && <p className="text-destructive">{t("approvalRules.notice.failed")}</p>}
          <div>
            <Button variant="outline" disabled={submitting} onClick={() => void acknowledge()}>
              {submitting
                ? label("acknowledge-approval-rules", "submitting")
                : label("acknowledge-approval-rules", "submit")}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
