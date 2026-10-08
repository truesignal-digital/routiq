import type { ApprovalChainStep, ApprovalRuleOverride, RoleApprovalChain } from "@routiq/contracts";
import type { TFunction } from "i18next";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { stepText } from "../approval-rules/chain-text.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { useCommandLabel } from "../commands/labels.js";
import { formatDayLong, formatMoney } from "../lib/format.js";
import { ChangeThresholdsForm, companyChain } from "./ChangeThresholdsForm.js";
import {
  useApprovalThresholds,
  useInvalidateApprovalThresholds,
} from "./useApprovalThresholds.js";

function StepList({
  steps,
  currency,
  label,
}: {
  steps: readonly ApprovalChainStep[];
  currency: string;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5 text-sm tabular-nums">
      {steps.map((step, index) => (
        <li key={`${step.outcome}-${step.upToMinor ?? "above"}`}>
          {stepText(t, steps, index, currency)}
        </li>
      ))}
    </ul>
  );
}

const sameSteps = (a: readonly ApprovalChainStep[], b: readonly ApprovalChainStep[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** One role's own chain; one list when its expenses and revenue meet the same one. */
function RoleChain({ entry, currency }: { entry: RoleApprovalChain; currency: string }) {
  const { t } = useTranslation();
  const roleName = t(`users.roles.${entry.role}`);
  const [first, ...rest] = entry.chains;
  const shared = first !== undefined && rest.every((chain) => sameSteps(chain.steps, first.steps));
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <h4 className="text-sm font-medium">{roleName}</h4>
      {shared ? (
        <StepList steps={first.steps} currency={currency} label={roleName} />
      ) : (
        entry.chains.map((chain) => (
          <div key={chain.commandType} className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">
              {t(`settings.approvals.kind.${chain.commandType}`)}
            </p>
            <StepList
              steps={chain.steps}
              currency={currency}
              label={t("settings.approvals.roleKind", {
                role: roleName,
                kind: t(`settings.approvals.kind.${chain.commandType}`),
              })}
            />
          </div>
        ))
      )}
    </div>
  );
}

function overrideText(t: TFunction, override: ApprovalRuleOverride, currency: string): string {
  return t("settings.approvals.override", {
    kind: override.commandType,
    scope: override.branchName ?? override.categoryCode ?? "",
    role: t(`users.roles.${override.requiredRole}`),
    bounded: override.amountMaxMinor === null ? "no" : "yes",
    amount: formatMoney(override.amountMaxMinor, { currency }),
  });
}

/**
 * Company settings → Approvals (#354): the money chain's two bands, what each
 * role's own entries meet, the branch and category exceptions the bands leave
 * alone, and the last change. Direction changes the bands here; the change
 * reaches members as the rules notice (#422).
 */
export function ApprovalSettings({ client = commandClient }: { client?: CommandClient }) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const headingId = useId();
  const { data, isPending, isError, refetch } = useApprovalThresholds();
  const invalidate = useInvalidateApprovalThresholds();
  const [editing, setEditing] = useState(false);

  const recording = data?.recordingThresholdMinor ?? null;
  const ceiling = data?.financeCeilingMinor ?? null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold">
            {t("settings.approvals.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("settings.approvals.description")}</p>
        </div>
        {data !== undefined && recording !== null && ceiling !== null && (
          <Button className="shrink-0" onClick={() => setEditing(true)}>
            {label("update-approval-threshold")}
          </Button>
        )}
      </div>

      {isPending && <LoadingState label={t("settings.approvals.loading")} rows={2} />}
      {isError && (
        <ErrorState
          message={t("settings.approvals.loadFailed")}
          retryLabel={t("settings.retry")}
          onRetry={() => void refetch()}
        />
      )}

      {data !== undefined && (
        <>
          <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
            {recording !== null && ceiling !== null ? (
              <StepList
                steps={companyChain({ recordingThresholdMinor: recording, financeCeilingMinor: ceiling })}
                currency={data.currency}
                label={t("settings.approvals.chainLabel")}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.approvals.noBands")}</p>
            )}
            {data.lastChange !== null && (
              <p className="text-xs text-muted-foreground">
                {data.lastChange.changedBy === null
                  ? t("approvalRules.notice.changedByRoutiq", {
                      date: formatDayLong(data.lastChange.changedAt),
                    })
                  : t("approvalRules.notice.changedBy", {
                      name: data.lastChange.changedBy,
                      date: formatDayLong(data.lastChange.changedAt),
                    })}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t("settings.approvals.byRole")}</h3>
            <p className="text-sm text-muted-foreground">{t("settings.approvals.byRoleHint")}</p>
            <div className="divide-y overflow-hidden rounded-xl border">
              {data.roles.map((entry) => (
                <RoleChain key={entry.role} entry={entry} currency={data.currency} />
              ))}
            </div>
          </div>

          {data.overrides.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("settings.approvals.overrides")}</h3>
              <p className="text-sm text-muted-foreground">{t("settings.approvals.overridesHint")}</p>
              <ul className="divide-y overflow-hidden rounded-xl border text-sm tabular-nums">
                {data.overrides.map((override, index) => (
                  <li key={index} className="px-4 py-3">
                    {overrideText(t, override, data.currency)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {editing && data !== undefined && recording !== null && ceiling !== null && (
        <ChangeThresholdsForm
          current={data}
          recordingThresholdMinor={recording}
          financeCeilingMinor={ceiling}
          client={client}
          onDone={(saved) => {
            setEditing(false);
            if (saved) void invalidate();
          }}
          onReload={async () => {
            await invalidate();
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}
