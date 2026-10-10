import type { SummaryTemplate } from "@routiq/contracts";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";

const SUMMARY_TONE: Record<SummaryTemplate, StatusBadgeTone> = {
  AHEAD: "success",
  BEHIND: "warning",
  FLAT: "neutral",
  NOT_ENOUGH_DATA: "neutral",
  FIRST_MONTH: "info",
};

/** The money summary's verdict beside its sentence ("Behind September"), never colour alone. */
export function SummaryStatusBadge({ template, label }: { template: SummaryTemplate; label: string }) {
  return (
    <StatusBadge tone={SUMMARY_TONE[template]} icon={null}>
      {label}
    </StatusBadge>
  );
}
