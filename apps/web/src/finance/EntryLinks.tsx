import type { FinancialEntryListItem, ModuleCode } from "@routiq/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { RecordText } from "@/components/record-number";
import { contributes } from "@/modules/manifest.js";

const LINK_CLASS =
  "inline-flex min-h-11 items-center underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground";

/**
 * Which of an entry's links this viewer gets: each only while the module that
 * adds it is on (`entry.workOrderLink`, `entry.tripLink`).
 */
export function visibleEntryLinks(
  links: FinancialEntryListItem["links"],
  enabledModules: readonly ModuleCode[] | undefined,
): { workOrder: boolean; trip: boolean } {
  return {
    workOrder:
      links.workOrderId !== null &&
      links.workOrderAssetId !== null &&
      links.workOrderDescription !== null &&
      contributes("fields", "entry.workOrderLink", enabledModules),
    trip:
      links.activityId !== null &&
      links.activityNumber !== null &&
      contributes("fields", "entry.tripLink", enabledModules),
  };
}

/**
 * What an entry belongs to: the work order, opened in its vehicle's workspace,
 * and the trip (#87). Renders nothing when the entry names neither. Work orders
 * have no number, so the link names the order by its description, the title it
 * carries on the vehicle's Maintenance tab (#547).
 */
export function EntryLinks({ links }: { links: FinancialEntryListItem["links"] }) {
  const { t } = useTranslation();
  const me = useMeContext();
  const { workOrderId, workOrderAssetId, workOrderDescription, activityId, activityNumber } = links;
  const shown = visibleEntryLinks(links, me?.enabledModules);
  const hasWorkOrder =
    shown.workOrder && workOrderId !== null && workOrderAssetId !== null && workOrderDescription !== null;
  const hasTrip = shown.trip && activityId !== null && activityNumber !== null;
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
