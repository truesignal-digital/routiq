import type { AssetLifecycleStatus } from "@routiq/contracts";
import { CircleCheck, CircleX, Wrench, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";

/** Lifecycle only: availability (grounded or not) is a separate fact (§3.4). */
const ASSET_STATUS: Record<AssetLifecycleStatus, { tone: StatusBadgeTone; icon: LucideIcon | null }> = {
  REGISTERED: { tone: "neutral", icon: null },
  IN_SERVICE: { tone: "success", icon: CircleCheck },
  UNDER_MAINTENANCE: { tone: "warning", icon: Wrench },
  SOLD: { tone: "neutral", icon: null },
  RETIRED: { tone: "neutral", icon: null },
  WRITTEN_OFF: { tone: "danger", icon: CircleX },
};

export function AssetStatusBadge({ status }: { status: AssetLifecycleStatus }) {
  const { t } = useTranslation();
  const { tone, icon } = ASSET_STATUS[status];
  return (
    <StatusBadge tone={tone} icon={icon}>
      {t(`assets.status.${status}`)}
    </StatusBadge>
  );
}
