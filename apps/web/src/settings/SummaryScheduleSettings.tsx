import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { InfoPopover } from "@/components/info-popover.js";
import { ErrorState, LoadingState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { useCommandLabel } from "../commands/labels.js";
import { SummaryScheduleForm } from "./SummaryScheduleForm.js";
import { useCompanySettings, useInvalidateCompanySettings } from "./useCompanySettings.js";

/**
 * Company settings › Overview summary (#669, dashboards.html#rule): when the
 * summary notice shows on the Dashboard and every module Overview. The
 * Director or an Administrator (#711) sets it for the company; each person can
 * still close the notice.
 */
export function SummaryScheduleSettings({ client = commandClient }: { client?: CommandClient }) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const headingId = useId();
  const { data, isPending, isError, refetch } = useCompanySettings();
  const invalidate = useInvalidateCompanySettings();
  const [editing, setEditing] = useState(false);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-1.5">
          <h2 id={headingId} className="text-lg font-semibold">
            {t("settings.summary.title")}
          </h2>
          <InfoPopover label={t("settings.summary.about")}>{t("settings.summary.description")}</InfoPopover>
        </div>
        {/* Approvals holds the page's one filled button. */}
        {data !== undefined && (
          <Button variant="outline" className="shrink-0" onClick={() => setEditing(true)}>
            {label("set-summary-schedule")}
          </Button>
        )}
      </div>

      {isPending && <LoadingState label={t("settings.summary.loading")} rows={1} />}
      {isError && (
        <ErrorState
          message={t("settings.summary.loadFailed")}
          retryLabel={t("settings.retry")}
          onRetry={() => void refetch()}
        />
      )}

      {data !== undefined && (
        <div data-slot="summary-schedule" className="flex flex-col gap-1 rounded-xl border px-4 py-3">
          <p className="text-sm font-medium">{t(`settings.summary.schedule.${data.summarySchedule}`)}</p>
          <p className="text-xs text-muted-foreground">{t("settings.summary.closable")}</p>
        </div>
      )}

      {editing && data !== undefined && (
        <SummaryScheduleForm
          current={{ schedule: data.summarySchedule, version: data.version }}
          client={client}
          onDone={() => void invalidate()}
          onReload={async () => {
            await invalidate();
            setEditing(false);
          }}
          onDismiss={() => setEditing(false)}
        />
      )}
    </section>
  );
}
