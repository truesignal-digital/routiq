import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { financialEntryFilters, LIST_LIMIT_DEFAULT } from "@routiq/contracts";
import { FileText, Maximize2, Plus, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterOption,
  type DataTableFilterValues,
} from "@/components/data-table";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import { assetDisplayName } from "@/assets/display.js";
import { useAssets } from "@/assets/useAssets.js";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { FinanceToolbar } from "@/finance/FinanceToolbar.js";
import {
  canReadFinanceEntries,
  canRecordFinance,
  canReverseEntry,
  entriesScope,
} from "@/finance/permissions.js";
import { toSortParam } from "@/lib/sort-param.js";
import {
  useFinanceEntryColumns,
  type FinanceEntryColumnId,
} from "@/finance/entryColumns.js";
import { useEntries } from "@/finance/useEntries.js";
import { formatDate } from "@/lib/format.js";
import { BranchScopedEmptyState, BranchScopeLine } from "@/shell/BranchScopeNotices.js";

const STATUS_OPTIONS = financialEntryFilters.shape.status.unwrap().options;
const DIRECTION_OPTIONS = financialEntryFilters.shape.direction.unwrap().options;

/** Module-level so the column memo in `useFinanceEntryColumns` holds. */
const LIST_COLUMNS: readonly FinanceEntryColumnId[] = [
  "entryNumber",
  "status",
  "economicDate",
  "postedAt",
  "category",
  "amount",
  "counterpartyName",
  "linkedTo",
];

/** Mirrors the read's own default so the header shows the order in force. */
const DEFAULT_SORTING: SortingState = [{ id: "postedAt", desc: true }];

export function FinanceEntriesScreen() {
  const { t } = useTranslation();
  const me = useMeContext();
  if (me === undefined) return <LoadingState label={t("finance.entries.loading")} />;
  if (!canReadFinanceEntries(me.role, me.enabledModules)) {
    return <PermissionDenied width="wide" title={t("finance.entries.title")}
      icon={<FileText className="size-7" aria-hidden />}
      code={deniedCode(me.enabledModules.includes("FINANCE"))} />;
  }
  return <FinanceEntriesContent />;
}

function FinanceEntriesContent() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const navigate = useNavigate();
  const me = useMeContext();
  const canRecord = canRecordFinance(me?.role, me?.enabledModules);
  // role-config: a driver's list holds only what they recorded (#264); the
  // screen says so, so a short list never reads as the whole ledger.
  const ownOnly = entriesScope(me?.role) === "OWN_ENTRIES";

  // Toolbar state keyed by the `useEntries` param it drives. `/v1/finance/entries`
  // does the filtering, so the table never narrows rows itself.
  // Not strict: /finance/record renders this list behind its record panel.
  const search = useSearch({ strict: false });
  const searchFilters = useMemo(() => ({
    periodCode: search.periodCode ?? "",
    status: search.status ?? "",
    direction: search.direction ?? "",
    assetId: search.assetId ?? "",
  }), [search]);
  const [filterValues, setFilterValues] = useState<DataTableFilterValues>(searchFilters);
  // Restore the list lens on history navigation as well as fresh deep links.
  useEffect(() => setFilterValues(searchFilters), [searchFilters]);
  const changeFilters = (values: DataTableFilterValues) => {
    setFilterValues(values);
    void navigate({
      to: "/finance/entries",
      replace: true,
      search: {
        periodCode: values["periodCode"] || undefined,
        status: STATUS_OPTIONS.find((status) => status === values["status"]),
        direction: DIRECTION_OPTIONS.find((direction) => direction === values["direction"]),
        assetId: values["assetId"] || undefined,
      },
    });
  };
  // Owned here so the view menu can sit in the toolbar row beside the tabs.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const periodCode = filterValues["periodCode"]?.trim() ?? "";
  const sort = toSortParam(sorting);

  // `sort` rides in the query key, so reordering starts a fresh cursor rather
  // than stitching pages from two different orders together.
  const entriesQuery = useEntries({
    ...(filterValues["status"] ? { status: filterValues["status"] } : {}),
    ...(filterValues["direction"] ? { direction: filterValues["direction"] } : {}),
    ...(periodCode ? { periodCode } : {}),
    ...(filterValues["assetId"] ? { assetId: filterValues["assetId"] } : {}),
    ...(sort ? { sort } : {}),
  });

  const assetsQuery = useAssets();
  const {
    hasNextPage: hasMoreAssets,
    isFetchingNextPage: isFetchingMoreAssets,
    fetchNextPage: fetchMoreAssets,
  } = assetsQuery;

  // The asset filter has to offer the whole fleet: stopping at the first keyset
  // page would silently drop assets an operator needs to filter by. Pilot fleets
  // are tens of rows, so draining the cursor costs a request or two.
  useEffect(() => {
    if (hasMoreAssets && !isFetchingMoreAssets) {
      void fetchMoreAssets();
    }
  }, [hasMoreAssets, isFetchingMoreAssets, fetchMoreAssets]);

  const assetOptions = useMemo<DataTableFilterOption[]>(
    () =>
      (assetsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((asset) => {
        const name = assetDisplayName(asset);
        return {
          value: asset.id,
          label:
            name === asset.assetCode
              ? asset.assetCode
              : t("finance.entries.filters.assetOption", {
                  code: asset.assetCode,
                  name,
                }),
        };
      }),
    [assetsQuery.data, t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        columnId: "status",
        type: "select",
        placeholder: t("finance.entries.filters.status"),
        options: STATUS_OPTIONS.map((status) => ({
          value: status,
          label: status === "LEDGER" ? t("finance.entries.filters.ledger") : t(`finance.entries.status.${status}`),
        })),
      },
      {
        columnId: "direction",
        type: "select",
        placeholder: t("finance.entries.detail.direction"),
        options: DIRECTION_OPTIONS.map((direction) => ({
          value: direction,
          label: t(direction === "EXPENSE" ? "finance.record.expenseLabel" : "finance.record.revenueLabel"),
        })),
      },
      {
        columnId: "periodCode",
        type: "search",
        placeholder: t("finance.entries.filters.periodPlaceholder"),
      },
      {
        columnId: "assetId",
        type: "select",
        placeholder: t("finance.entries.filters.asset"),
        options: assetOptions,
      },
    ],
    [assetOptions, t],
  );

  const allEntries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? [];

  const columns = useFinanceEntryColumns(LIST_COLUMNS);

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("finance.entries.title")}
      />
      <FinanceToolbar>
        <DataTableViewOptions
          columns={columns}
          value={columnVisibility}
          onChange={setColumnVisibility}
          primaryColumn={{ columnId: "entryNumber" }}
        />
        {canRecord && (
          // A link styled as a button: Base UI's Button would announce it as
          // a button (#136).
          <Link
            to="/finance/record"
            className={buttonVariants({ size: "desktop-sm" })}
          >
            <Plus aria-hidden />
            {t("finance.entries.recordAction")}
          </Link>
        )}
      </FinanceToolbar>

      {ownOnly && (
        <p data-slot="money-scope-line" className="mt-3 text-sm text-muted-foreground">
          {t("finance.entries.ownScope")}
        </p>
      )}
      <BranchScopeLine
        className="mt-3"
        count={entriesQuery.isPending ? undefined : allEntries.length}
        hasMore={entriesQuery.hasNextPage}
      />

      {entriesQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.entries.loadFailed")}
          retryLabel={t("finance.entries.retry")}
          onRetry={() => void entriesQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          {/* Each filter change is a new query key, so the fetch reports
              `isPending`. Rendering the table through it keeps the toolbar
              mounted — replacing it with a full-page loader would yank the
              controls out from under the operator mid-refinement. */}
          <DataTable
            columns={columns}
            data={allEntries}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={changeFilters}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            onSortingChange={setSorting}
            primaryColumn={{ columnId: "entryNumber" }}
            rowActions={(entry) => [
              {
                key: "fullScreen",
                label: t("finance.entries.viewer.fullScreen"),
                icon: Maximize2,
                onSelect: () =>
                  void navigate({
                    to: "/finance/entries/$entryId",
                    params: { entryId: entry.id },
                  }),
              },
              // role-config: reversal is an approver's call, and only on a
              // posted original — the same gate the detail screen applies.
              ...(canReverseEntry(me?.role, entry)
                ? [
                    {
                      key: "reverse",
                      label: label("reverse-entry"),
                      icon: Undo2,
                      destructive: true,
                      onSelect: () =>
                        // The dialog lives on the detail screen; opening it
                        // there beats a second copy of the same command.
                        void navigate({
                          to: "/finance/entries/$entryId",
                          params: { entryId: entry.id },
                          search: { reverse: true },
                        }),
                    },
                  ]
                : []),
            ]}
            rowViewer={{
              title: (entry) => entry.entryNumber,
              description: (entry) =>
                t("finance.entries.viewer.description", {
                  date: formatDate(entry.economicDate),
                }),
              render: (entry) => <EntrySummary entryId={entry.id} />,
              fullScreen: {
                label: t("finance.entries.viewer.fullScreen"),
                onOpen: (entry) =>
                  void navigate({
                    to: "/finance/entries/$entryId",
                    params: { entryId: entry.id },
                  }),
              },
            }}
            loadMore={{
              hasNextPage: entriesQuery.hasNextPage,
              isFetching: entriesQuery.isFetchingNextPage,
              onLoadMore: () => void entriesQuery.fetchNextPage(),
              pageSize: LIST_LIMIT_DEFAULT,
            }}
            emptyState={
              entriesQuery.isPending ? (
                <LoadingState label={t("finance.entries.loading")} />
              ) : ownOnly ? (
                <EmptyState
                  icon={<FileText className="size-7" aria-hidden />}
                  message={t("finance.entries.ownEmpty")}
                />
              ) : (
                <BranchScopedEmptyState
                  icon={<FileText className="size-7" aria-hidden />}
                  message={t("finance.entries.branchEmpty")}
                  firstRun={{ message: t("finance.entries.empty") }}
                />
              )
            }
          />
        </div>
      )}
    </PageContainer>
  );
}
