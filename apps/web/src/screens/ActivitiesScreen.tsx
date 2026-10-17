import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { Maximize2, Route } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ACTIVITY_MISSING_FILTERS } from "@routiq/contracts";
import { DateRangePicker } from "@/components/date-range-picker";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterValues,
} from "@/components/data-table";
import { ErrorState, LoadingState } from "@/components/page";
import { useMeContext } from "@/auth/me.js";
import {
  useActivityColumns,
  type ActivityColumnId,
} from "@/activities/activityColumns.js";
import { useActivities } from "@/activities/useActivities.js";
import { contributes } from "@/modules/manifest.js";
import { useAssetOptions } from "@/assets/useAssetOptions.js";
import { useCategories } from "@/categories/useCategories.js";
import { localizedLabel } from "@/lib/format.js";
import { toSortParam } from "@/lib/sort-param.js";
import { BranchScopedEmptyState, BranchScopeLine } from "@/shell/BranchScopeNotices.js";

const STATUS_OPTIONS = ["OPEN", "CLOSED"] as const;
const COMPLETENESS_OPTIONS = ["COMPLETE", "COMPLETE_WITH_EXCEPTIONS"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The filters the Overview's tiles set, kept in the URL so a tile's view is a link (#302). */
const URL_FILTERS = ["status", "completeness", "from", "to", "missing"] as const;
type UrlFilters = Partial<Record<(typeof URL_FILTERS)[number], string>>;

/** Module-level so the column memo holds across renders. */
const LIST_COLUMNS: readonly ActivityColumnId[] = [
  "activityNumber",
  "status",
  "activityType",
  "startedAt",
  "endedAt",
  "primaryAssetCode",
  "customerName",
  "legCount",
  "crewCount",
];

/** Mirrors the read's own default so the header shows the order in force. */
const DEFAULT_SORTING: SortingState = [{ id: "startedAt", desc: true }];

/**
 * Trips › Trips (#665): the trip list, starting with its search and filters.
 * The tiles that sat above it moved into the Overview, and each opens this
 * list already filtered through the URL.
 */
export function ActivitiesScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  // Fuel is a money fact: the server counts it only while Money is on.
  const fuelCounted = contributes("fields", "trip.money", me?.enabledModules);
  const missingOptions = useMemo(
    () => ACTIVITY_MISSING_FILTERS.filter((option) => option !== "fuel" || fuelCounted),
    [fuelCounted],
  );
  const activityTypesQuery = useCategories("ACTIVITY_TYPE");
  // No branch named, so the picker follows the shell's agency like the list it
  // filters — offering a truck whose activities this list can never show would
  // only produce an empty table. It drains the full asset cursor; pilot
  // workspaces are intentionally small enough for that tradeoff.
  const assetOptions = useAssetOptions();

  const urlSearch = useSearch({ from: "/app/activities/list" });
  const [localFilters, setLocalFilters] = useState<DataTableFilterValues>({});
  const filterValues = useMemo<DataTableFilterValues>(() => {
    const values: DataTableFilterValues = { ...localFilters };
    for (const key of URL_FILTERS) {
      const value = urlSearch[key];
      if (value !== undefined) values[key] = value;
    }
    return values;
  }, [localFilters, urlSearch]);

  const setUrlFilters = (next: UrlFilters) =>
    void navigate({
      to: "/activities/list",
      replace: true,
      search: {
        status: STATUS_OPTIONS.find((option) => option === next.status),
        completeness: COMPLETENESS_OPTIONS.find((option) => option === next.completeness),
        from: next.from !== undefined && ISO_DATE.test(next.from) ? next.from : undefined,
        to: next.to !== undefined && ISO_DATE.test(next.to) ? next.to : undefined,
        missing: ACTIVITY_MISSING_FILTERS.find((option) => option === next.missing),
      },
    });

  const setFilterValues = (
    update: DataTableFilterValues | ((values: DataTableFilterValues) => DataTableFilterValues),
  ) => {
    const values = typeof update === "function" ? update(filterValues) : update;
    const local: DataTableFilterValues = { ...values };
    const url: UrlFilters = {};
    for (const key of URL_FILTERS) {
      const value = local[key];
      delete local[key];
      if (value !== undefined && value !== "") url[key] = value;
    }
    setLocalFilters(local);
    if (URL_FILTERS.some((key) => (url[key] ?? "") !== (urlSearch[key] ?? ""))) {
      setUrlFilters(url);
    }
  };

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const sort = toSortParam(sorting);

  // `/v1/activities` does the filtering; the table never narrows rows itself,
  // or the counts would describe the page instead of the fleet. The branch is
  // absent on purpose: `useActivities` is a branch-scoped read, so the shell's
  // agency reaches it without this screen passing anything.
  const activitiesQuery = useActivities({
    ...(filterValues["status"] ? { status: filterValues["status"] } : {}),
    ...(filterValues["completeness"]
      ? { completeness: filterValues["completeness"] }
      : {}),
    ...(filterValues["activityTypeCode"]
      ? { activityTypeCode: filterValues["activityTypeCode"] }
      : {}),
    ...(filterValues["assetId"] ? { assetId: filterValues["assetId"] } : {}),
    ...(filterValues["from"] ? { from: filterValues["from"] } : {}),
    ...(filterValues["to"] ? { to: filterValues["to"] } : {}),
    ...(filterValues["missing"] ? { missing: filterValues["missing"] } : {}),
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
      {
        columnId: "missing",
        type: "select",
        placeholder: t("activities.filters.missing"),
        options: missingOptions.map((value) => ({
          value,
          label: t(`activities.filters.missingOptions.${value}`),
        })),
      },
      {
        columnId: "activityTypeCode",
        type: "select",
        placeholder: t("activities.filters.activityType"),
        options: (activityTypesQuery.data ?? []).map((activityType) => ({
          value: activityType.code,
          label: localizedLabel(activityType, i18n.language),
        })),
      },
      // No branch filter: the header switcher is the one place branch scope is
      // set, so a second control here could only contradict it.
      {
        columnId: "assetId",
        type: "select",
        placeholder: t("activities.filters.asset"),
        options: assetOptions,
      },
      {
        columnId: "from",
        columnIds: ["from", "to"],
        type: "custom",
        render: (
          <DateRangePicker
            fromValue={filterValues["from"]}
            toValue={filterValues["to"]}
            onFromChange={(from) =>
              setFilterValues((values) => {
                const next = { ...values };
                if (from === "") delete next["from"];
                else next["from"] = from;
                return next;
              })
            }
            onToChange={(to) =>
              setFilterValues((values) => {
                const next = { ...values };
                if (to === "") delete next["to"];
                else next["to"] = to;
                return next;
              })
            }
          />
        ),
      },
    ],
    [activityTypesQuery.data, assetOptions, i18n.language, filterValues, t, missingOptions],
  );

  const columns = useActivityColumns(LIST_COLUMNS);
  const allActivities = activitiesQuery.data?.pages.flatMap((page) => page.items) ?? [];


  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BranchScopeLine
          count={activitiesQuery.isPending ? undefined : allActivities.length}
          hasMore={activitiesQuery.hasNextPage ?? false}
        />
        <DataTableViewOptions
          className="ms-auto"
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
            defaultSorting={DEFAULT_SORTING}
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
              activitiesQuery.isPending ? (
                <LoadingState label={t("activities.loading")} />
              ) : (
                <BranchScopedEmptyState
                  icon={<Route className="size-7" aria-hidden />}
                  message={t("activities.branchEmptyHint")}
                  firstRun={{ message: t("activities.emptyHint") }}
                />
              )
            }
          />
        </div>
      )}
    </>
  );
}
