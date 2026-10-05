import type { WorkOrderStatus } from "@routiq/contracts";
import { Ban, CircleCheck, CircleX, Clock, Hourglass, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";

/**
 * How far through its life a work order is, at a glance. SUBMITTED and
 * COMPLETION_SUBMITTED both wait on a decision, so warning; APPROVED is work
 * in progress, so info; REJECTED is a refusal, so danger; CANCELLED stays
 * neutral because nothing went wrong, the job simply never happened.
 */
const WORK_ORDER_STATUS: Record<WorkOrderStatus, { tone: StatusBadgeTone; icon: LucideIcon }> = {
  SUBMITTED: { tone: "warning", icon: Clock },
  APPROVED: { tone: "info", icon: Hourglass },
  COMPLETION_SUBMITTED: { tone: "warning", icon: Clock },
  COMPLETED: { tone: "success", icon: CircleCheck },
  REJECTED: { tone: "danger", icon: CircleX },
  CANCELLED: { tone: "neutral", icon: Ban },
};

/** For a chip that names the work order rather than its status, such as its reference. */
export function workOrderStatusTone(status: WorkOrderStatus): StatusBadgeTone {
  return WORK_ORDER_STATUS[status].tone;
}

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const { t } = useTranslation();
  const { tone, icon } = WORK_ORDER_STATUS[status];
  return (
    <StatusBadge tone={tone} icon={icon}>
      {t(`maintenance.workOrders.status.${status}`)}
    </StatusBadge>
  );
}
