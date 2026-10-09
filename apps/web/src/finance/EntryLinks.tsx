import type { FinancialEntryListItem } from "@routiq/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { RecordText } from "@/components/record-number";

const LINK_CLASS =
  "inline-flex min-h-11 items-center underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground";

/**
 * What an entry belongs to: the work order, opened in its vehicle's workspace,
 * and the trip (#87). Renders nothing when the entry names neither. Work orders
 * have no number, so the link names the order by its description, the title it
 * carries on the vehicle's Maintenance tab (#547).
 */
export function EntryLinks({ links }: { links: FinancialEntryListItem["links"] }) {
  const { t } = useTranslation();
  const { workOrderId, workOrderAssetId, workOrderDescription, activityId, activityNumber } = links;
  const hasWorkOrder = workOrderId !== null && workOrderAssetId !== null && workOrderDescription !== null;
  const hasTrip = activityId !== null && activityNumber !== null;
  if (!hasWorkOrder && !hasTrip) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-3">
      {hasWorkOrder && (
        <Link
          to="/assets/$assetId/maintenance"
          params={{ assetId: workOrderAssetId }}
          search={{ panel: `work_order:${workOrderId}` }}
          className={`${LINK_CLASS} max-w-full`}
        >
          <span className="line-clamp-2 min-w-0">{t("finance.entries.detail.workOrderLink", { title: workOrderDescription })}</span>
        </Link>
      )}
      {hasTrip && (
        <Link to="/activities/$activityId" params={{ activityId }} className={LINK_CLASS}>
          <span>
            <RecordText text={t("finance.entries.detail.tripLink", { number: activityNumber })} numbers={[activityNumber]} />
          </span>
        </Link>
      )}
    </span>
  );
}
