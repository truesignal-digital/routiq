import type { FinancialEntryListItem, ModuleCode } from "@routiq/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { RecordText } from "@/components/record-number";
import { contributes } from "@/modules/manifest.js";
import { recordReference } from "@/vehicle/model.js";

const LINK_CLASS =
  "inline-flex min-h-11 items-center underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground";

/**
 * Which of an entry's links this viewer gets: the work order only while the
 * module that adds it (its `entry.workOrderLink` field) is on.
 */
export function visibleEntryLinks(
  links: FinancialEntryListItem["links"],
  enabledModules: readonly ModuleCode[] | undefined,
): { workOrder: boolean; trip: boolean } {
  return {
    workOrder:
      links.workOrderId !== null &&
      links.workOrderAssetId !== null &&
      contributes("fields", "entry.workOrderLink", enabledModules),
    trip: links.activityId !== null && links.activityNumber !== null,
  };
}

/**
 * What an entry belongs to: the work order, opened in its vehicle's workspace,
 * and the trip (#87). Renders nothing when the entry names neither.
 */
export function EntryLinks({ links }: { links: FinancialEntryListItem["links"] }) {
  const { t } = useTranslation();
  const me = useMeContext();
  const { workOrderId, workOrderAssetId, activityId, activityNumber } = links;
  const shown = visibleEntryLinks(links, me?.enabledModules);
  const hasWorkOrder = shown.workOrder && workOrderId !== null && workOrderAssetId !== null;
  const hasTrip = shown.trip && activityId !== null && activityNumber !== null;
  if (!hasWorkOrder && !hasTrip) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-3">
      {hasWorkOrder && (
        <Link
          to="/assets/$assetId/maintenance"
          params={{ assetId: workOrderAssetId }}
          search={{ panel: `work_order:${workOrderId}` }}
          className={LINK_CLASS}
        >
          <span>{t("finance.entries.detail.workOrderLink", { ref: recordReference(workOrderId) })}</span>
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
