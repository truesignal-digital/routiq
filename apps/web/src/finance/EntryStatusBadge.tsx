import type { FinancialEntryListItem } from "@routiq/contracts";
import { CircleCheck, CircleX, Clock, Undo2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";

export type EntryStatus = FinancialEntryListItem["status"];

/**
 * The only place an entry status gets its look (#177). A reversed entry is
 * neutral in colour but needs its own glyph, so every glyph is spelled out
 * rather than left to the tone defaults.
 */
const ENTRY_STATUS: Record<EntryStatus, { tone: StatusBadgeTone; icon: LucideIcon }> = {
  SUBMITTED: { tone: "warning", icon: Clock },
  POSTED: { tone: "success", icon: CircleCheck },
  REJECTED: { tone: "danger", icon: CircleX },
  REVERSED: { tone: "neutral", icon: Undo2 },
};

export function EntryStatusBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation();
  const { tone, icon } = ENTRY_STATUS[status];
  return (
    <StatusBadge tone={tone} icon={icon}>
      {t(`finance.entries.status.${status}`)}
    </StatusBadge>
  );
}
