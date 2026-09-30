import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Route, TriangleAlert } from "lucide-react";
import type { ActivityListItem } from "@routiq/contracts";
import { useActivities } from "@/activities/useActivities.js";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatRelativeTime, localizedLabel } from "@/lib/format.js";
import { ALL_BRANCHES } from "@/shell/branch-context.js";
import { useVehicle } from "../context.js";
import { RecordRow, RowIcon, RowMenu, Sep, TabHeader } from "../parts.js";
import { TabAction } from "./MaintenanceTab.js";

type TripFacts = Pick<
  ActivityListItem,
  "status" | "completeness" | "completenessCodes" | "originName" | "destinationName"
>;

/** "Douala → Bafoussam", or nothing when no leg says where it went. */
export function tripRoute(trip: TripFacts, t: TFunction): string | null {
  if (trip.originName === null || trip.destinationName === null) return null;
  return t("vehicle.trips.route", { from: trip.originName, to: trip.destinationName });
}

export function TripState({ trip }: { trip: TripFacts }) {
  const { t } = useTranslation();
  if (trip.status === "OPEN") {
    return (
      <StatusBadge tone="info" icon={Route} className="rounded-md">
        {t("vehicle.trips.onTheRoad")}
      </StatusBadge>
    );
  }
  if (trip.completeness === "COMPLETE_WITH_EXCEPTIONS") {
    return (
      <StatusBadge tone="warning" icon={TriangleAlert} className="rounded-md">
        {t("vehicle.trips.closedWithGaps", { count: trip.completenessCodes.length })}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" className="rounded-md">
      {t("vehicle.trips.closed")}
    </StatusBadge>
  );
}

export function TripsTab() {
  const { t } = useTranslation();
  const { gates } = useVehicle();
  if (!gates.trips) {
    return (
      <PermissionDenied
        title={t("vehicle.tabs.trips")}
        icon={<Route className="size-7" aria-hidden />}
        code={deniedCode(false)}
      />
    );
  }
  return <TripsSection />;
}

/** The trips this vehicle ran, newest first; a row opens the trip in the panel. */
function TripsSection() {
  const { t, i18n } = useTranslation();
  const { asset, panel, can } = useVehicle();
  const query = useActivities({ assetId: asset.id, branchId: ALL_BRANCHES, sort: "startedAt:desc" });
  const locale = i18n.language;

  const trips = query.data?.pages.flatMap((page) => page.items) ?? [];
  const totalKm = trips.reduce((sum, trip) => sum + (trip.distanceKm ?? 0), 0);

  return (
    <section>
      <TabHeader
        title={t("vehicle.trips.title")}
        description={
          trips.length > 0
            ? t("vehicle.trips.descriptionWithKm", { km: totalKm })
            : t("vehicle.trips.description")
        }
        action={<TabAction actionKey="start-trip" />}
      />
      {query.isPending ? (
        <LoadingState label={t("vehicle.trips.loading")} />
      ) : query.isError ? (
        <ErrorState
          message={t("vehicle.trips.loadFailed")}
          retryLabel={t("vehicle.panel.retry")}
          onRetry={() => void query.refetch()}
        />
      ) : trips.length === 0 ? (
        <EmptyState icon={<Route className="size-6" aria-hidden />} message={t("vehicle.trips.empty")} />
      ) : (
        <>
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {trips.map((trip) => (
                <RecordRow
                  key={trip.id}
                  icon={<RowIcon icon={Route} tone={trip.status === "OPEN" ? "info" : "neutral"} />}
                  title={tripRoute(trip, t) ?? localizedLabel(trip.activityType, locale)}
                  detail={
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      <span className="tabular-nums">{trip.activityNumber}</span>
                      <Sep />
                      <span>{trip.customerName ?? localizedLabel(trip.activityType, locale)}</span>
                      {trip.driverName !== null && (
                        <>
                          <Sep />
                          <span>{trip.driverName}</span>
                        </>
                      )}
                      {trip.distanceKm !== null && (
                        <>
                          <Sep />
                          <span className="tabular-nums">{t("vehicle.trips.km", { value: trip.distanceKm })}</span>
                        </>
                      )}
                    </span>
                  }
                  status={<TripState trip={trip} />}
                  aside={
                    trip.startedAt === null ? null : (
                      <>
                        <div>{formatDate(trip.startedAt, locale)}</div>
                        <div className="text-xs text-muted-foreground">
                          {trip.endedAt === null
                            ? t("vehicle.trips.stillOpen")
                            : formatRelativeTime(trip.endedAt, locale)}
                        </div>
                      </>
                    )
                  }
                  menu={
                    <RowMenu
                      label={t("vehicle.trips.tripNumber", { number: trip.activityNumber })}
                      steps={
                        can("record-expense")
                          ? [{ step: { key: "add-cost", record: { kind: "trip", id: trip.id } } }]
                          : []
                      }
                      onStep={panel.openStep}
                    />
                  }
                  onOpen={() => panel.openRecord({ kind: "trip", id: trip.id })}
                />
              ))}
            </ul>
          </Card>
          {query.hasNextPage && (
            <Button
              variant="outline"
              className="mt-3 h-9"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("vehicle.history.loadMore")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
