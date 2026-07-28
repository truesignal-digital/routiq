import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { Maximize2, Route } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterValues,
} from "@/components/data-table";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import {
  useActivityColumns,
  type ActivityColumnId,
} from "@/activities/activityColumns.js";
import { canViewActivities } from "@/activities/permissions.js";
import { useActivities } from "@/activities/useActivities.js";
import { toSortParam } from "@/lib/sort-param.js";

const STATUS_OPTIONS = ["OPEN", "CLOSED"] as const;
const COMPLETENESS_OPTIONS = ["COMPLETE", "COMPLETE_WITH_EXCEPTIONS"] as const;

/** Module-level so the column memo holds across renders. */
const LIST_COLUMNS: readonly ActivityColumnId[] = [
  "activityNumber",
  "status",
  "activityType",
  "startedAt",
  "primaryAssetCode",
  "customerName",
  "legCount",
];

/** Mirrors the read's own default so the header shows the order in force. */
const DEFAULT_SORTING: SortingState = [{ id: "startedAt", desc: true }];

export function ActivitiesScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canView = canViewActivities(me?.enabledModules);

  const [filterValues, setFilterValues] = useState<DataTableFilterValues>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const sort = toSortParam(sorting);

  // `/v1/activities` does the filtering; the table never narrows rows itself,
  // or the counts would describe the page instead of the fleet.
  const activitiesQuery = useActivities({
    ...(filterValues["status"] ? { status: filterValues["status"] } : {}),
    ...(filterValues["completeness"]
      ? { completeness: filterValues["completeness"] }
      : {}),
    ...(sort ? { sort } : {}),
  });

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        columnId: "status",
        type: "select",
        placeholder: t("activities.filters.status"),
        options: STATUS_OPTIONS.map((status) => ({
          value: status,
          label: t(`activities.status.${status}`),
        })),
      },
      {
        columnId: "completeness",
        type: "select",
        placeholder: t("activities.filters.completeness"),
        options: COMPLETENESS_OPTIONS.map((value) => ({
          value,
          label: t(`activities.completeness.${value}`),
        })),
      },
    ],
    [t],
  );

  const columns = useActivityColumns(LIST_COLUMNS);
  const allActivities = activitiesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  if (me !== undefined && !canView) {
    return (
      <PermissionDenied
        width="wide"
        title={t("activities.title")}
        icon={<Route className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("ACTIVITIES"))}
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader title={t("activities.title")} />

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <DataTableViewOptions
          columns={columns}
          value={columnVisibility}
          onChange={setColumnVisibility}
          primaryColumn={{ columnId: "activityNumber" }}
        />
      </div>

      {activitiesQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("activities.loadFailed")}
          retryLabel={t("activities.retry")}
          onRetry={() => void activitiesQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={allActivities}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={setFilterValues}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            onSortingChange={setSorting}
            primaryColumn={{ columnId: "activityNumber" }}
            rowActions={(activity) => [
              {
                key: "open",
                label: t("activities.viewer.open"),
                icon: Maximize2,
                onSelect: () =>
                  void navigate({
                    to: "/activities/$activityId",
                    params: { activityId: activity.id },
                  }),
              },
            ]}
            onRowClick={(activity) =>
              void navigate({
                to: "/activities/$activityId",
                params: { activityId: activity.id },
              })
            }
            // Keyset, never a page count: a cursor cannot honestly say
            // "page 3 of 12" (ADR-0003).
            loadMore={{
              hasNextPage: activitiesQuery.hasNextPage ?? false,
              isFetching: activitiesQuery.isFetchingNextPage,
              onLoadMore: () => void activitiesQuery.fetchNextPage(),
            }}
            emptyState={
              <EmptyState
                icon={<Route className="size-7" aria-hidden />}
                message={t("activities.emptyHint")}
              />
            }
          />
        </div>
      )}
    </PageContainer>
  );
}
