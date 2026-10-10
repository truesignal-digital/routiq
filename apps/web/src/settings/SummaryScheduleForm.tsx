import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SUMMARY_SCHEDULES,
  setSummarySchedulePayload,
  type SetSummarySchedulePayload,
  type SummarySchedule,
} from "@routiq/contracts";
import { useCommandLabel } from "@/commands/labels.js";
import { PinnedField } from "@/components/command-form.js";
import { ChoiceField } from "@/components/form/fields.js";
import { FormLayout } from "@/components/form/form-layout.js";
import { useCommandForm } from "@/components/use-command-form.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent } from "../commands/intent.js";

export interface SummaryScheduleFormProps {
  /** The schedule in force and the version it was read at (the envelope's expectedVersion). */
  current: { schedule: SummarySchedule; version: number };
  client?: CommandClient | undefined;
  /** After the command committed; the host reloads the settings. */
  onDone?: (() => void) | undefined;
  /** The schedule moved since it was read: reload, then close. */
  onReload?: (() => Promise<void>) | undefined;
  onDismiss: () => void;
}

/**
 * Company settings › Dashboard summary (#669): Direction picks when the
 * summary notice shows on every Overview, for the whole company. The schedule
 * in force is pinned; nothing is picked until Direction chooses.
 */
export function SummaryScheduleForm({
  current,
  client = commandClient,
  onDone,
  onReload,
  onDismiss,
}: SummaryScheduleFormProps) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const [intent] = useState(() =>
    createCommandIntent<SetSummarySchedulePayload>(client, "set-summary-schedule", 1),
  );
  const form = useCommandForm(setSummarySchedulePayload, "set-summary-schedule", 1, {
    defaults: () => ({}),
    send: (payload) => intent.submit(payload, { expectedVersion: current.version }),
    success: { namespace: "settings", message: "summaryScheduleSaved" },
    onDone,
    onDismiss,
    client,
  });

  return (
    <FormLayout
      kind="quick-entry"
      form={form}
      title={label("set-summary-schedule")}
      description={t("settings.summary.form.description")}
      pinned={
        <PinnedField label={t("settings.summary.form.now")}>
          {t(`settings.summary.schedule.${current.schedule}`)}
        </PinnedField>
      }
      onReload={onReload}
    >
      <ChoiceField
        name="schedule"
        label={t("settings.summary.form.field")}
        stacked
        options={SUMMARY_SCHEDULES.map((schedule) => ({
          value: schedule,
          label: t(`settings.summary.schedule.${schedule}`),
        }))}
      />
    </FormLayout>
  );
}
