import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { useActivityColumns, type ActivityColumnId } from "@/activities/activityColumns.js";
import { canReadPlanning } from "@/activities/tripsTabs.js";
import { useActivities } from "@/activities/useActivities.js";
import { DataTable } from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { PermissionDenied } from "@/components/permission-denied.js";
import { BranchScopeLine } from "@/shell/BranchScopeNotices.js";

/** Module-level so the column memo holds across renders. */
const PLANNED_COLUMNS: readonly ActivityColumnId[] = [
  "activityNumber",
  "status",
  "activityType",
  "primaryAssetCode",
  "customerName",
  "legCount",
];

/**
 * Trips › Planning (#665): the Scheduling module's tab, the trips planned and
 * not yet started (ADR-0012). The planning board comes later; until then the
 * planners see the planned trips as a list, each opening its trip.
 */
export function PlanningTab() {
  const { t } = useTranslation();
  const me = useMeContext();
  if (me !== undefined && !canReadPlanning(me.role, me.enabledModules)) {
    return (
      <PermissionDenied
        title={t("activities.page.tabs.planning")}
        icon={<CalendarClock className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }
  return <PlannedTrips />;
}

function PlannedTrips() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const columns = useActivityColumns(PLANNED_COLUMNS);
  // Asked by name: unasked, the list holds started trips only (ADR-0012 §7).
  const query = useActivities({ status: "PLANNED" });
  const trips = query.data?.pages.flatMap((page) => page.items) ?? [];
  const open = (id: string) => void navigate({ to: "/activities/$activityId", params: { activityId: id } });

  return (
    <div data-slot="planning-tab" className="flex flex-col gap-4">
      <BranchScopeLine count={query.isPending ? undefined : trips.length} hasMore={query.hasNextPage ?? false} />
      {query.isError ? (
        <ErrorState
          message={t("activities.loadFailed")}
          retryLabel={t("activities.retry")}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={trips}
          getRowId={(trip) => trip.id}
          primaryColumn={{ columnId: "activityNumber" }}
          rowActions={(trip) => [
            { key: "open", label: t("activities.viewer.open"), icon: Maximize2, onSelect: () => open(trip.id) },
          ]}
          onRowClick={(trip) => open(trip.id)}
          loadMore={{
            hasNextPage: query.hasNextPage ?? false,
            isFetching: query.isFetchingNextPage,
            onLoadMore: () => void query.fetchNextPage(),
          }}
          emptyState={
            query.isPending ? (
              <LoadingState label={t("activities.loading")} />
            ) : (
              <EmptyState icon={<CalendarClock className="size-7" aria-hidden />} message={t("activities.planning.empty")} />
            )
          }
        />
      )}
    </div>
  );
}
