import type { ActivityDetail, ActivityListItem } from "@routiq/contracts";
import { CircleCheck, Route, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";

export type TripStatusFacts = Pick<ActivityListItem, "status" | "completeness" | "completenessCodes">;

/**
 * A trip's one state, with one colour, wherever the trip appears (#94, #177).
 * It is derived from status and completeness only; start and end stay times.
 */
export function TripStatusBadge({ trip }: { trip: TripStatusFacts }) {
  const { t } = useTranslation();
  if (trip.status === "OPEN") {
    return (
      <StatusBadge tone="info" icon={Route}>
        {t("activities.state.onTheRoad")}
      </StatusBadge>
    );
  }
  if (trip.completeness === "COMPLETE_WITH_EXCEPTIONS") {
    return (
      <StatusBadge tone="warning" icon={TriangleAlert}>
        {t("activities.state.closedWithGaps", { count: trip.completenessCodes.length })}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" icon={CircleCheck}>
      {t("activities.state.closed")}
    </StatusBadge>
  );
}

/** Row icons stay quiet once the trip is over; only one on the road stands out. */
export function tripIconTone(status: ActivityListItem["status"]): StatusBadgeTone {
  return status === "OPEN" ? "info" : "neutral";
}

type LoadState = NonNullable<ActivityDetail["legs"][number]["loadState"]>;

const LOAD_STATE: Record<LoadState, StatusBadgeTone> = {
  LADEN: "success",
  EMPTY: "neutral",
  PARTIAL: "info",
};

export function LegLoadBadge({ state }: { state: LoadState }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={LOAD_STATE[state]} icon={null}>
      {t(`activities.record.legs.loadStates.${state}`)}
    </StatusBadge>
  );
}
