import type { ActivityListItem } from "@routiq/contracts";
import { Route, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/status-badge.js";

export type TripStateFacts = Pick<ActivityListItem, "status" | "completeness" | "completenessCodes">;

/**
 * A trip's one state, with one colour, wherever the trip appears (#94). It is
 * derived from status and completeness only; start and end stay times.
 */
export function TripState({ trip }: { trip: TripStateFacts }) {
  const { t } = useTranslation();
  if (trip.status === "OPEN") {
    return (
      <StatusBadge tone="info" icon={Route} className="rounded-md">
        {t("activities.state.onTheRoad")}
      </StatusBadge>
    );
  }
  if (trip.completeness === "COMPLETE_WITH_EXCEPTIONS") {
    return (
      <StatusBadge tone="warning" icon={TriangleAlert} className="rounded-md">
        {t("activities.state.closedWithGaps", { count: trip.completenessCodes.length })}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" className="rounded-md">
      {t("activities.state.closed")}
    </StatusBadge>
  );
}
