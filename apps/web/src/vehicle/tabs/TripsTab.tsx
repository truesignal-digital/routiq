import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Route } from "lucide-react";
import type { ActivityListItem } from "@routiq/contracts";
import { TripStatusBadge, tripIconTone } from "@/activities/TripStatusBadge.js";
import { useActivities } from "@/activities/useActivities.js";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDateTime, localizedLabel, notRecorded } from "@/lib/format.js";
import { ALL_BRANCHES } from "@/shell/branch-context.js";
import { useVehicle } from "../context.js";
import { RecordRow, RowIcon, RowMenu, Sep, TabHeader } from "../parts.js";
import { TabAction } from "./TabAction.js";

type TripFacts = Pick<ActivityListItem, "originName" | "destinationName">;

/** "Douala → Bafoussam", or nothing when no leg says where it went. */
export function tripRoute(trip: TripFacts, t: TFunction): string | null {
  if (trip.originName === null || trip.destinationName === null) return null;
  return t("vehicle.trips.route", { from: trip.originName, to: trip.destinationName });
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
                  icon={<RowIcon icon={Route} tone={tripIconTone(trip.status)} />}
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
                  status={<TripStatusBadge trip={trip} />}
                  aside={
                    <>
                      <div className="whitespace-nowrap">
                        {t("vehicle.trips.startedAt", {
                          time: trip.startedAt === null ? notRecorded(locale) : formatDateTime(trip.startedAt, locale),
                        })}
                      </div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {t("vehicle.trips.endedAt", {
                          time: trip.endedAt === null ? notRecorded(locale) : formatDateTime(trip.endedAt, locale),
                        })}
                      </div>
                    </>
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
              className="mt-3 desktop:h-9"
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
