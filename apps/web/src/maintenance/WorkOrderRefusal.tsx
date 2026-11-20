import { useTranslation } from "react-i18next";
import type { WorkOrderListItem } from "@routiq/contracts";
import { NotRecorded } from "@/components/not-recorded.js";
import { formatDateTime } from "@/lib/format.js";

/**
 * A refused work order's why, who and when, shown first on the sheet and the
 * vehicle's record panel (#746). Renders nothing unless the order is REJECTED.
 */
export function WorkOrderRefusal({ workOrder }: { workOrder: WorkOrderListItem }) {
  const { t, i18n } = useTranslation();
  if (workOrder.status !== "REJECTED") return null;
  const { rejectReason, rejectedBy, rejectedAt } = workOrder;

  return (
    <section
      aria-label={t("maintenance.refusal.title")}
      className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <h3 className="font-semibold text-destructive">{t("maintenance.refusal.title")}</h3>
      <p className="mt-1">{rejectReason === null || rejectReason === "" ? <NotRecorded /> : rejectReason}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("maintenance.refusal.by")}</dt>
          <dd>{rejectedBy?.displayName ?? t("history.actor.unknown")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("maintenance.refusal.at")}</dt>
          <dd className="tabular-nums">
            {rejectedAt === null ? <NotRecorded /> : formatDateTime(rejectedAt, i18n.language)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** The start of a refusal's reason for a list row; the row's own width truncates it. */
export function RefusalReasonLine({ workOrder }: { workOrder: WorkOrderListItem }) {
  if (workOrder.status !== "REJECTED" || workOrder.rejectReason === null || workOrder.rejectReason === "") {
    return null;
  }
  return (
    <span className="line-clamp-1 max-w-64 text-xs text-muted-foreground" title={workOrder.rejectReason}>
      {workOrder.rejectReason}
    </span>
  );
}
