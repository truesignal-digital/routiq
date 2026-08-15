import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import {
  ArrowLeftRight,
  ArrowRight,
  FileText,
  Maximize2,
  PlayCircle,
  Plus,
  Search,
  Truck,
} from "lucide-react";
import type { AssetListItem } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterValues,
  type DataTableRowAction,
} from "@/components/data-table";
import { MetricStrip, type MetricTiles } from "@/components/metric-strip.js";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import {
  AssetActionDialog,
  assetActions,
  type AssetActionKey,
} from "@/assets/AssetActions.js";
import { useAssetColumns, type AssetColumnId } from "@/assets/assetColumns.js";
import { assetFilterStatuses, isAssetFilter } from "@/assets/display.js";
import { canManageAssets, canViewAssets } from "@/assets/permissions.js";
import { useAssetRegistrationReference } from "@/assets/reference.js";
import { useAssets } from "@/assets/useAssets.js";
import { useAssetSummary } from "@/assets/useAssetSummary.js";
import { localizedLabel } from "@/lib/format.js";
import { toSortParam } from "@/lib/sort-param.js";
import { BranchScopedEmptyState, BranchScopeLine } from "@/shell/BranchScope.js";
import { useBranchScope } from "@/shell/branch-scope.js";

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

export function AssetsStub() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canView = canViewAssets(me?.enabledModules);
  const canManage = canManageAssets(me?.role, me?.enabledModules);
  const documentsEnabled = me?.enabledModules.includes("DOCUMENTS") ?? false;

  const [filterValues, setFilterValues] = useState<DataTableFilterValues>({});
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
  const statuses = assetFilterStatuses(
    isAssetFilter(statusChoice) ? statusChoice : "ALL",
  );

  // Everything but the lifecycle bucket: the tiles count inside the same
  // narrowing the table shows, and a status filter would make each bucket
  // count itself. The branch is not in here — `useAssets` and `useAssetSummary`
  // are branch-scoped reads, so the shell's agency reaches both by itself.
  const scope = useMemo(
    () => ({
      ...(search === "" ? {} : { search }),
      ...(category === "" ? {} : { category }),
    }),
    [search, category],
  );

  const assetsQuery = useAssets({
    ...scope,
    ...(statuses === undefined ? {} : { status: statuses }),
    ...(sort === undefined ? {} : { sort }),
  });
  const summaryQuery = useAssetSummary(scope);

  const assets = assetsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  // Toolbar filters only. The shell's agency is the other way a list can come
  // back empty, and it has its own empty state: "clear filters" cannot reach it.
  const narrowed = Object.values(filterValues).some((value) => value !== "");
  const { scoped } = useBranchScope();

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
    [t, i18n.language, reference.data],
  );

  const tiles = useMemo<MetricTiles>(() => {
    const counts = summaryQuery.data;
    return [
      {
        label: t("assets.metrics.total"),
        value: counts === undefined ? null : String(counts.total),
      },
      {
        label: t("assets.metrics.inService"),
        value: counts === undefined ? null : String(counts.inService),
      },
      {
        label: t("assets.metrics.attention"),
        value: counts === undefined ? null : String(counts.attention),
        tone: "warning",
      },
    ];
  }, [summaryQuery.data, t]);

  if (me !== undefined && !canView) {
    return (
      <PermissionDenied
        width="wide"
        title={t("assets.title")}
        icon={<Truck className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("ASSETS"))}
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("assets.title")}
        actions={
          canManage ? (
            <Link
              to="/assets/new"
              className="hidden min-h-11 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 sm:inline-flex"
            >
              <Plus className="size-4" aria-hidden />
              {t("assets.register")}
            </Link>
          ) : undefined
        }
      />
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        {t("assets.subtitle")}
      </p>

      <MetricStrip
        className="mt-6"
        tiles={tiles}
        isPending={summaryQuery.isPending}
        isError={summaryQuery.isError}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
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
                  label: t(`assets.actions.${action}`),
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
              narrowed ? (
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
              ) : scoped ? (
                // A branch with no assets is not a workspace with no assets:
                // the first-run state would claim the fleet is empty while it
                // sits in another agency.
                <BranchScopedEmptyState
                  icon={<Truck className="size-7" aria-hidden />}
                  message={t("assets.branchEmptyHint")}
                />
              ) : (
                <EmptyState
                  icon={
                    <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <Truck className="size-8" strokeWidth={1.55} aria-hidden />
                    </span>
                  }
                  message={
                    <span className="flex flex-col items-center">
                      <strong className="text-lg font-semibold text-foreground">
                        {t("assets.emptyTitle")}
                      </strong>
                      <span className="mt-2">{t("assets.emptyHint")}</span>
                    </span>
                  }
                  action={
                    canManage
                      ? {
                          label: (
                            <span className="flex items-center gap-2">
                              {t("assets.emptyAction")}
                              <ArrowRight className="size-4" aria-hidden />
                            </span>
                          ),
                          onClick: () => void navigate({ to: "/assets/new" }),
                        }
                      : undefined
                  }
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

      {canManage && (
        <Link
          to="/assets/new"
          aria-label={t("assets.register")}
          className="fixed right-4 bottom-6 z-20 flex size-14 items-center justify-center rounded-full bg-signal text-signal-foreground shadow-lg transition active:scale-95 sm:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </Link>
      )}
    </PageContainer>
  );
}
