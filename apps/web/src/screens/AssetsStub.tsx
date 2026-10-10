import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import {
  ArrowLeftRight,
  ArrowRight,
  FileText,
  Maximize2,
  PlayCircle,
  Search,
  Truck,
} from "lucide-react";
import type { AssetAvailabilityFilter, AssetListItem } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterValues,
  type DataTableRowAction,
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { useMeContext } from "@/auth/me.js";
import {
  AssetActionDialog,
  ASSET_ACTION_COMMANDS,
  assetActions,
  type AssetActionKey,
} from "@/assets/AssetActions.js";
import { useAssetColumns, type AssetColumnId } from "@/assets/assetColumns.js";
import { assetFilterQuery, isAssetFilter } from "@/assets/display.js";
import { canManageAssets } from "@/assets/permissions.js";
import { contributes } from "@/modules/manifest.js";
import { useAssetRegistrationReference } from "@/reference/asset-registration.js";
import { useAssets } from "@/assets/useAssets.js";
import { localizedLabel } from "@/lib/format.js";
import { toSortParam } from "@/lib/sort-param.js";
import { BranchScopedEmptyState, BranchScopeLine } from "@/shell/BranchScopeNotices.js";

/** Module-level so the column memo holds across renders. */
const LIST_COLUMNS: readonly AssetColumnId[] = [
  "asset",
  "status",
  "category",
  "branch",
  "registrationNumber",
];

/** Mirrors the read's own default so the header shows the order in force. */
const DEFAULT_SORTING: SortingState = [{ id: "assetCode", desc: false }];

const PRIMARY_COLUMN = { columnId: "assetCode" } as const;

/** The status choices, minus ALL: the select's own reset item is ALL. */
const STATUS_OPTIONS = ["IN_SERVICE", "ATTENTION"] as const;

/**
 * The Overview's availability tiles (#665), each a filter here. A rule owned
 * by a module that is off is not offered: the server would match nothing.
 */
const AVAILABILITY_MODULE_FIELD = {
  CAN_DRIVE: undefined,
  GROUNDED: "assets.attentionGrounding",
  IDLE: "vehicle.lastTrip",
} as const satisfies Record<AssetAvailabilityFilter, string | undefined>;
const AVAILABILITY_OPTIONS = Object.keys(AVAILABILITY_MODULE_FIELD) as AssetAvailabilityFilter[];

/**
 * Trucks › Trucks (#665): the fleet list, starting with its search and
 * filters. The tiles that sat above it moved into the Overview, and each
 * opens this list already filtered through the URL.
 */
export function AssetsStub() {
  const { t, i18n } = useTranslation();
  const label = useCommandLabel();
  const navigate = useNavigate();
  const me = useMeContext();
  // The shell opens this page only while Assets is on (`ModulePageGate`).
  const canManage = canManageAssets(me?.role, me?.enabledModules);
  // The row's Documents entry opens the vehicle's Documents tab, so it goes with the tab.
  const documentsEnabled = contributes("vehicleTabs", "documents", me?.enabledModules);

  const enabledModules = me?.enabledModules;
  const availabilityOptions = useMemo(
    () =>
      AVAILABILITY_OPTIONS.filter((option) => {
        const field = AVAILABILITY_MODULE_FIELD[option];
        return field === undefined || contributes("fields", field, enabledModules);
      }),
    [enabledModules],
  );

  // The status and availability buckets live in the URL, where the Overview's
  // tiles put them (#302); the other toolbar filters stay local to the visit.
  const urlSearch = useSearch({ from: "/app/assets/list" });
  const [localFilters, setLocalFilters] = useState<DataTableFilterValues>({});
  const filterValues = useMemo<DataTableFilterValues>(
    () => ({
      ...localFilters,
      ...(urlSearch.status === undefined ? {} : { status: urlSearch.status }),
      ...(urlSearch.availability === undefined ? {} : { availability: urlSearch.availability }),
    }),
    [localFilters, urlSearch.status, urlSearch.availability],
  );
  const setFilterValues = (values: DataTableFilterValues) => {
    const { status, availability, ...rest } = values;
    setLocalFilters(rest);
    if ((status ?? "") !== (urlSearch.status ?? "") || (availability ?? "") !== (urlSearch.availability ?? "")) {
      void navigate({
        to: "/assets/list",
        replace: true,
        search: {
          status: STATUS_OPTIONS.find((option) => option === status),
          availability: AVAILABILITY_OPTIONS.find((option) => option === availability),
        },
      });
    }
  };
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [pending, setPending] = useState<{
    asset: AssetListItem;
    action: AssetActionKey;
  }>();
  const sort = toSortParam(sorting);

  const reference = useAssetRegistrationReference();
  const columns = useAssetColumns(LIST_COLUMNS);

  const search = filterValues["search"] ?? "";
  const category = filterValues["category"] ?? "";
  const statusChoice = filterValues["status"] ?? "";
  const statusQuery = assetFilterQuery(
    isAssetFilter(statusChoice) ? statusChoice : "ALL",
  );
  const availability = AVAILABILITY_OPTIONS.find((option) => option === filterValues["availability"]);

  // The branch is not in here — `useAssets` is a branch-scoped read, so the
  // shell's agency reaches it by itself.
  const assetsQuery = useAssets({
    ...(search === "" ? {} : { search }),
    ...(category === "" ? {} : { category }),
    ...statusQuery,
    ...(availability === undefined ? {} : { availability }),
    ...(sort === undefined ? {} : { sort }),
  });

  const assets = assetsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  // Toolbar filters only. The shell's agency is the other way a list can come
  // back empty, and it has its own empty state: "clear filters" cannot reach it.
  const narrowed = Object.values(filterValues).some((value) => value !== "");

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        columnId: "search",
        type: "search",
        placeholder: t("assets.searchPlaceholder"),
      },
      {
        columnId: "status",
        type: "select",
        placeholder: t("assets.filters.status"),
        options: STATUS_OPTIONS.map((value) => ({
          value,
          label: t(`assets.filters.${value}`),
        })),
      },
      {
        columnId: "availability",
        type: "select",
        placeholder: t("assets.filters.availability"),
        options: availabilityOptions.map((value) => ({
          value,
          label: t(`assets.filters.availabilityOptions.${value}`),
        })),
      },
      // No branch filter: the header switcher is the one place branch scope is
      // set, so a second control here could only contradict it.
      {
        columnId: "category",
        type: "select",
        placeholder: t("assets.filters.category"),
        options: (reference.data?.assetClasses ?? []).map((assetClass) => ({
          value: assetClass.code,
          label: localizedLabel(assetClass, i18n.language),
        })),
      },
    ],
    [t, i18n.language, reference.data, availabilityOptions],
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BranchScopeLine
          count={assetsQuery.isPending ? undefined : assets.length}
          hasMore={assetsQuery.hasNextPage ?? false}
        />
        <DataTableViewOptions
          className="ms-auto"
          columns={columns}
          value={columnVisibility}
          onChange={setColumnVisibility}
          primaryColumn={PRIMARY_COLUMN}
        />
      </div>

      {assetsQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={
            <span className="flex flex-col gap-1">
              <strong className="font-semibold text-destructive">
                {t("assets.errorTitle")}
              </strong>
              <span>{t("assets.errorHint")}</span>
            </span>
          }
          retryLabel={t("assets.retry")}
          onRetry={() => void assetsQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={assets}
            getRowId={(asset) => asset.id}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={setFilterValues}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            defaultSorting={DEFAULT_SORTING}
            onSortingChange={setSorting}
            primaryColumn={PRIMARY_COLUMN}
            rowActions={(asset) => {
              const actions: DataTableRowAction<typeof asset>[] = [
                {
                  key: "open",
                  label: t("assets.actions.open"),
                  icon: Maximize2,
                  onSelect: () =>
                    void navigate({
                      to: "/assets/$assetId",
                      params: { assetId: asset.id },
                    }),
                },
              ];
              // Documents are a module, not a role: a workspace without it has
              // no such screen to reach.
              if (documentsEnabled) {
                actions.push({
                  key: "documents",
                  label: t("documents.link"),
                  icon: FileText,
                  onSelect: () =>
                    void navigate({
                      to: "/assets/$assetId/documents",
                      params: { assetId: asset.id },
                    }),
                });
              }
              // role-config: which commands this asset offers is decided in one
              // place, so the row menu and the asset's own page always agree.
              for (const action of assetActions(
                asset,
                me?.role,
                me?.enabledModules,
              )) {
                actions.push({
                  key: action,
                  label: label(ASSET_ACTION_COMMANDS[action]),
                  icon: action === "commission" ? PlayCircle : ArrowLeftRight,
                  onSelect: () => setPending({ asset, action }),
                });
              }
              return actions;
            }}
            onRowClick={(asset) =>
              void navigate({
                to: "/assets/$assetId",
                params: { assetId: asset.id },
              })
            }
            // Keyset, never a page count: a cursor cannot honestly say
            // "page 3 of 12" (ADR-0003).
            loadMore={{
              hasNextPage: assetsQuery.hasNextPage ?? false,
              isFetching: assetsQuery.isFetchingNextPage,
              onLoadMore: () => void assetsQuery.fetchNextPage(),
            }}
            emptyState={
              assetsQuery.isPending ? (
                <LoadingState label={t("assets.loading")} />
              ) : narrowed ? (
                <EmptyState
                  icon={<Search className="size-7" aria-hidden />}
                  message={
                    <span className="flex flex-col gap-1">
                      <strong className="font-semibold text-foreground">
                        {t("assets.noResultsTitle")}
                      </strong>
                      <span>{t("assets.noResultsHint")}</span>
                    </span>
                  }
                />
              ) : (
                // A branch with no assets is not a workspace with no assets:
                // the first-run state would claim the fleet is empty while it
                // sits in another agency.
                <BranchScopedEmptyState
                  icon={<Truck className="size-7" aria-hidden />}
                  message={t("assets.branchEmptyHint")}
                  firstRun={{
                    icon: (
                      <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <Truck className="size-8" strokeWidth={1.55} aria-hidden />
                      </span>
                    ),
                    message: (
                      <span className="flex flex-col items-center">
                        <strong className="text-lg font-semibold text-foreground">
                          {t("assets.emptyTitle")}
                        </strong>
                        <span className="mt-2">{t("assets.emptyHint")}</span>
                      </span>
                    ),
                    action: canManage
                      ? {
                          label: (
                            <span className="flex items-center gap-2">
                              {label("register-asset")}
                              <ArrowRight className="size-4" aria-hidden />
                            </span>
                          ),
                          onClick: () => void navigate({ to: "/assets/new" }),
                        }
                      : undefined,
                  }}
                />
              )
            }
          />
        </div>
      )}

      {pending !== undefined && (
        <AssetActionDialog
          asset={pending.asset}
          action={pending.action}
          onDismiss={() => setPending(undefined)}
        />
      )}

    </>
  );
}
