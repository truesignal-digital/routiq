import type { IssueStatus, WorkOrderStatus } from "@routiq/contracts";
import { CircleCheck, Clock, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/status-badge.js";
import { isActiveWorkOrder } from "./status.js";

export interface IssueStatusFacts {
  status: IssueStatus;
  workOrders: readonly { status: WorkOrderStatus }[];
}

/**
 * An open problem either waits for someone to plan the repair (warning) or is
 * already being worked on in a work order (info). Resolved is done; a
 * dismissal is not a failure, so it stays neutral.
 */
export function IssueStatusBadge({ issue }: { issue: IssueStatusFacts }) {
  const { t } = useTranslation();
  if (issue.status === "OPEN") {
    return issue.workOrders.some((wo) => isActiveWorkOrder(wo.status)) ? (
      <StatusBadge tone="info" icon={Wrench}>
        {t("vehicle.maintenance.inWorkOrder")}
      </StatusBadge>
    ) : (
      <StatusBadge tone="warning" icon={Clock}>
        {t("vehicle.maintenance.notPlanned")}
      </StatusBadge>
    );
  }
  if (issue.status === "RESOLVED") {
    return (
      <StatusBadge tone="success" icon={CircleCheck}>
        {t("maintenance.issues.status.RESOLVED")}
      </StatusBadge>
    );
  }
  return <StatusBadge tone="neutral">{t("maintenance.issues.status.DISMISSED")}</StatusBadge>;
}
