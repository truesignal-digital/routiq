import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { financialEntryFilters, LIST_LIMIT_DEFAULT } from "@routiq/contracts";
import type { FinancialEntryListItem } from "@routiq/contracts";
import { FileText, Maximize2, ReceiptText, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import {
  DataTable,
  type DataTableFilter,
  type DataTableFilterOption,
  type DataTableFilterValues,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { useMeContext } from "@/auth/me.js";
import { assetDisplayName } from "@/assets/display.js";
import { useAssets } from "@/assets/useAssets.js";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { ReverseEntryForm } from "@/finance/EntryDecisionForms.js";
import { RecordAgainSheet } from "@/finance/RecordAgainSheet.js";
import {
  canReadFinance,
  canReverseEntry,
  entriesScope,
  recordAgainStep,
} from "@/finance/permissions.js";
import { useFinanceSummary } from "@/finance/useFinanceSummary.js";
import { toSortParam } from "@/lib/sort-param.js";
import {
  useEntryListDefaultVisibility,
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

/**
 * Money › Entries (#664): every revenue and expense, starting with its search
 * and filters. The page's header and tabs belong to the Money page around it
 * (`FinanceScreen`), which also turns away a role that reads no entries; the
 * tiles moved to the Overview.
 */
export function FinanceEntriesScreen() {
  const { t } = useTranslation();
  const me = useMeContext();
  if (me === undefined) return <LoadingState label={t("finance.entries.loading")} />;
  return <FinanceEntriesContent />;
}

function FinanceEntriesContent() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const navigate = useNavigate();
  const me = useMeContext();
  // role-config: a driver's list holds only what they recorded (#264); the
  // screen says so, so a short list never reads as the whole ledger.
  const ownOnly = entriesScope(me?.role) === "OWN_ENTRIES";
  // role-config: the books view is for ledger readers (#427); everyone else
  // reads one line per event.
  const canReadBooks = canReadFinance(me?.role, me?.enabledModules);

  // Toolbar state keyed by the `useEntries` param it drives. `/v1/finance/entries`
  // does the filtering, so the table never narrows rows itself.
  // Not strict: /finance/record renders this list behind its record panel.
  const routeSearch = useSearch({ strict: false });
  // Narrowed to this list's values: other routes share these names with other
  // values (the truck's Money tab has `evidence=missing`). Memoised so the
  // filter effect below sees a stable object.
  const search = useMemo(
    () => ({
      ...routeSearch,
      status: STATUS_OPTIONS.find((status) => status === routeSearch.status),
      evidence: routeSearch.evidence === "MISSING" ? ("MISSING" as const) : undefined,
    }),
    [routeSearch],
  );
  // The one count the server keeps for a filter here: what `evidence=MISSING` returns.
  const summary = useFinanceSummary().data;
  const books = canReadBooks && search.view === "books";
  const searchFilters = useMemo<DataTableFilterValues>(() => ({
    periodCode: search.periodCode ?? "",
    status: search.status ?? "",
    direction: search.direction ?? "",
    assetId: search.assetId ?? "",
    evidence: search.evidence ?? "",
    economicMonth: search.economicMonth ?? "",
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
        // A tile's month the toolbar names as a chip; clearing every filter clears it too.
        economicMonth: values["economicMonth"] || undefined,
        evidence: values["evidence"] === "MISSING" ? ("MISSING" as const) : undefined,
        periodCode: values["periodCode"] || undefined,
        status: STATUS_OPTIONS.find((status) => status === values["status"]),
        direction: DIRECTION_OPTIONS.find((direction) => direction === values["direction"]),
        assetId: values["assetId"] || undefined,
        view: search.view === "waiting" ? undefined : search.view,
      },
    });
  };
  const setFilter = (key: string, value: string) => changeFilters({ ...filterValues, [key]: value });
  const changeBooks = (next: boolean) =>
    void navigate({
      to: "/finance/entries",
      replace: true,
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        view: next ? ("books" as const) : undefined,
      }),
    });
  // Owned here so the view menu can sit in the toolbar row beside the tabs.
  const defaultVisibility = useEntryListDefaultVisibility();
  const [chosenVisibility, setColumnVisibility] = useState<VisibilityState>();
  const columnVisibility = chosenVisibility ?? defaultVisibility;
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  // Cancel entry from the record panel (#525): the panel closes and the dialog
  // takes over, as Reject does in the waiting view.
  const [cancelling, setCancelling] = useState<Pick<FinancialEntryListItem, "id" | "rowVersion" | "links">>();
  const [recordingAgainId, setRecordingAgainId] = useState<string>();
  const periodCode = filterValues["periodCode"]?.trim() ?? "";
  const sort = toSortParam(sorting);

  // `sort` rides in the query key, so reordering starts a fresh cursor rather
  // than stitching pages from two different orders together.
  const entriesQuery = useEntries({
    ...(filterValues["status"] ? { status: filterValues["status"] } : {}),
    ...(filterValues["direction"] ? { direction: filterValues["direction"] } : {}),
    ...(periodCode ? { periodCode } : {}),
    ...(filterValues["economicMonth"] ? { economicMonth: filterValues["economicMonth"] } : {}),
    ...(filterValues["evidence"] === "MISSING" ? { evidence: "MISSING" as const } : {}),
    ...(filterValues["assetId"] ? { assetId: filterValues["assetId"] } : {}),
    ...(books ? { view: "books" as const } : {}),
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
      {
        columnId: "evidence",
        type: "custom",
        render: (
          <MissingReceiptToggle
            pressed={filterValues["evidence"] === "MISSING"}
            count={summary?.missingReceipt.count}
            onToggle={(pressed) => setFilter("evidence", pressed ? "MISSING" : "")}
          />
        ),
      },
      ...(filterValues["economicMonth"]
        ? [
            {
              columnId: "economicMonth",
              type: "custom" as const,
              render: (
                <MonthChip
                  month={filterValues["economicMonth"]}
                  onClear={() => setFilter("economicMonth", "")}
                />
              ),
            },
          ]
        : []),
      ...(canReadBooks
        ? [
            {
              columnId: "view",
              type: "custom" as const,
              render: (
                <label className="flex min-h-11 w-fit items-center gap-2 text-sm desktop:min-h-8">
                  <Checkbox checked={books} onCheckedChange={(checked) => changeBooks(checked)} />
                  {t("finance.entries.events.booksView")}
                </label>
              ),
            },
          ]
        : []),
    ],
    [assetOptions, t, filterValues, summary?.missingReceipt.count, canReadBooks, books],
  );

  const allEntries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? [];

  const columns = useFinanceEntryColumns(LIST_COLUMNS);

  return (
    <>
      <BranchScopeLine
        className="mb-3"
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
        <div>
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
            enableColumnVisibility
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            defaultSorting={DEFAULT_SORTING}
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
                        // The row menu hands off to the detail page with the
                        // dialog open; the record panel opens it in place.
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
              // role-config: the same gate as the row menu and the detail page.
              actions: (entry, drawer) =>
                canReverseEntry(me?.role, entry) ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11"
                    onClick={() => {
                      drawer.close();
                      setCancelling({ id: entry.id, rowVersion: entry.rowVersion, links: entry.links });
                    }}
                  >
                    {label("reverse-entry")}
                  </Button>
                ) : null,
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

      {cancelling !== undefined && (
        <ReverseEntryForm
          surface="dialog"
          entry={{ id: cancelling.id, rowVersion: cancelling.rowVersion }}
          // role-config: a work-order cost is recorded again by the roles that book one (#559).
          {...recordAgainStep(me, cancelling, {
            recordAgain: () => {
              setRecordingAgainId(cancelling.id);
              setCancelling(undefined);
            },
            openWorkOrder: (assetId, workOrderId) =>
              void navigate({
                to: "/assets/$assetId/maintenance",
                params: { assetId },
                search: { panel: `work_order:${workOrderId}` },
              }),
          })}
          onDismiss={() => setCancelling(undefined)}
        />
      )}
      {recordingAgainId !== undefined && (
        <RecordAgainSheet
          entryId={recordingAgainId}
          onClose={() => setRecordingAgainId(undefined)}
        />
      )}
    </>
  );
}

/** The month an Overview tile opened the list on, named and removable. */
function MonthChip({ month, onClear }: { month: string; onClear: () => void }) {
  const { t, i18n } = useTranslation();
  const name = t("finance.entries.filters.economicMonth", {
    month: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${month}-01T00:00:00Z`)),
  });
  return (
    <Button
      type="button"
      variant="secondary"
      size="desktop-sm"
      data-slot="money-month-chip"
      aria-label={t("finance.money.lens.clear", { name })}
      onClick={onClear}
    >
      {name}
      <X aria-hidden />
    </Button>
  );
}

/**
 * Missing receipt as a filter with its count, the number the Overview tile
 * used to repeat above the list (dashboards.html#money-entries).
 */
function MissingReceiptToggle({
  pressed,
  count,
  onToggle,
}: {
  pressed: boolean;
  count: number | undefined;
  onToggle: (pressed: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "outline"}
      size="desktop-sm"
      aria-pressed={pressed}
      data-slot="money-missing-filter"
      onClick={() => onToggle(!pressed)}
    >
      <ReceiptText aria-hidden />
      {t("finance.money.lens.missing")}
      {count !== undefined && <span className="text-muted-foreground tabular-nums">{count}</span>}
    </Button>
  );
}
