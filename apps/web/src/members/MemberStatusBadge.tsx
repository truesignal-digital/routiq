import type { MemberStatus } from "@routiq/contracts";
import { CircleCheck, Lock, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";

/** A locked member waits for an administrator to reset their PIN. */
const MEMBER_STATUS: Record<MemberStatus, { tone: StatusBadgeTone; icon: LucideIcon | null }> = {
  ACTIVE: { tone: "success", icon: CircleCheck },
  LOCKED: { tone: "warning", icon: Lock },
  DEACTIVATED: { tone: "neutral", icon: null },
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  const { t } = useTranslation();
  const { tone, icon } = MEMBER_STATUS[status];
  return (
    <StatusBadge tone={tone} icon={icon}>
      {t(`users.status.${status}`)}
    </StatusBadge>
  );
}
