import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { financialEntryFilters, LIST_LIMIT_DEFAULT } from "@routiq/contracts";
import type { FinanceSummaryResponse } from "@routiq/contracts";
import { CalendarCheck, FileText, Maximize2, Plus, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterOption,
  type DataTableFilterValues,
} from "@/components/data-table";
import { MetricStrip, moneyMetric, type MetricTile, type MetricTiles } from "@/components/metric-strip.js";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import { assetDisplayName } from "@/assets/display.js";
import { useAssets } from "@/assets/useAssets.js";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { ReverseEntryForm } from "@/finance/EntryDecisionForms.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { useEntry } from "@/finance/useEntry.js";
import {
  canApproveEntries,
  canManagePeriods,
  canReadFinance,
  canReadFinanceEntries,
  canRecordFinance,
  canReverseEntry,
  entriesScope,
} from "@/finance/permissions.js";
import { useFinanceSummary } from "@/finance/useFinanceSummary.js";
import { WaitingApprovals } from "@/finance/WaitingApprovals.js";
import { toSortParam } from "@/lib/sort-param.js";
import {
  useEntryListDefaultVisibility,
  useFinanceEntryColumns,
  type FinanceEntryColumnId,
} from "@/finance/entryColumns.js";
import { useEntries } from "@/finance/useEntries.js";
import { formatDate, formatMoney, formatRelativeTime } from "@/lib/format.js";
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
  const canApprove = canApproveEntries(me?.role, me?.enabledModules);
  // role-config: the waiting view is a decider's queue; anyone else sent to it
  // lands on the plain list rather than on an empty queue.
  const waitingView = search.view === "waiting" && canApprove;
  const summaryQuery = useFinanceSummary();
  const summary = summaryQuery.data;
  const books = canReadBooks && search.view === "books";
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
        // A tile's lens the toolbar does not show survives a toolbar change.
        economicMonth: search.economicMonth,
        evidence: search.evidence,
        periodCode: values["periodCode"] || undefined,
        status: STATUS_OPTIONS.find((status) => status === values["status"]),
        direction: DIRECTION_OPTIONS.find((direction) => direction === values["direction"]),
        assetId: values["assetId"] || undefined,
        view: search.view,
      },
    });
  };
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
  const [cancelling, setCancelling] = useState<{ id: string; rowVersion: number }>();
  const [recordingAgainId, setRecordingAgainId] = useState<string>();
  const periodCode = filterValues["periodCode"]?.trim() ?? "";
  const sort = toSortParam(sorting);

  // `sort` rides in the query key, so reordering starts a fresh cursor rather
  // than stitching pages from two different orders together.
  const entriesQuery = useEntries({
    ...(filterValues["status"] ? { status: filterValues["status"] } : {}),
    ...(filterValues["direction"] ? { direction: filterValues["direction"] } : {}),
    ...(periodCode ? { periodCode } : {}),
    ...(search.economicMonth ? { economicMonth: search.economicMonth } : {}),
    ...(search.evidence ? { evidence: search.evidence } : {}),
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
    ],
    [assetOptions, t],
  );

  const allEntries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? [];

  const columns = useFinanceEntryColumns(LIST_COLUMNS);

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("finance.entries.title")}
        actions={
          <>
            {canManagePeriods(me?.role, me?.enabledModules) && (
              // Until the Company group lands (#312), the monthly task is
              // reached from here rather than from daily navigation.
              <Link
                to="/finance/periods"
                className={buttonVariants({ variant: "outline" })}
              >
                <CalendarCheck aria-hidden />
                {t("finance.periods.title")}
              </Link>
            )}
            {canRecord && (
              // A link styled as a button: Base UI's Button would announce it
              // as a button (#136). The page's one primary action.
              <Link to="/finance/record" className={buttonVariants()}>
                <Plus aria-hidden />
                {label("record-expense")}
              </Link>
            )}
          </>
        }
      />
      <MoneyLead summary={summary} />

      <MoneyTiles
        summary={summary}
        isPending={summaryQuery.isPending}
        isError={summaryQuery.isError}
        ownOnly={ownOnly}
        canApprove={canApprove}
        search={search}
        onLens={(lens) =>
          void navigate({ to: "/finance/entries", replace: true, search: lens })
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <ActiveLensChip
          search={search}
          waitingView={waitingView}
          onClear={() => void navigate({ to: "/finance/entries", replace: true, search: {} })}
        />
        {!waitingView && (
          <div className="ml-auto">
            <DataTableViewOptions
              columns={columns}
              value={columnVisibility}
              onChange={setColumnVisibility}
              primaryColumn={{ columnId: "entryNumber" }}
            />
          </div>
        )}
      </div>

      {waitingView ? (
        <WaitingApprovals arrivingWidened={search.branch === "all"} />
      ) : (
      <>
      {canReadBooks && (
        <label className="mt-3 flex min-h-11 w-fit items-center gap-2 text-sm desktop:min-h-8">
          <Checkbox checked={books} onCheckedChange={(checked) => changeBooks(checked)} />
          {t("finance.entries.events.booksView")}
        </label>
      )}
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
              // role-config: the same gate as the row menu and the detail page.
              actions: (entry, drawer) =>
                canReverseEntry(me?.role, entry) ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11"
                    onClick={() => {
                      drawer.close();
                      setCancelling({ id: entry.id, rowVersion: entry.rowVersion });
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
      </>
      )}

      {cancelling !== undefined && (
        <ReverseEntryForm
          surface="dialog"
          entry={cancelling}
          onRecordAgain={() => {
            setRecordingAgainId(cancelling.id);
            setCancelling(undefined);
          }}
          onDismiss={() => setCancelling(undefined)}
        />
      )}
      {recordingAgainId !== undefined && (
        <RecordAgainSheet
          entryId={recordingAgainId}
          onClose={() => setRecordingAgainId(undefined)}
        />
      )}
    </PageContainer>
  );
}

/** After a "wrong details" cancellation: the recording form, pre-filled from the cancelled entry. */
function RecordAgainSheet({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const entryQuery = useEntry(entryId);
  if (entryQuery.data === undefined) return null;
  return (
    <RecordEntryForm
      surface="sheet"
      recordAgainFrom={entryQuery.data}
      onRecorded={onClose}
      onDismiss={onClose}
    />
  );
}

type MoneySearch = {
  view?: "events" | "books" | "waiting" | undefined;
  status?: (typeof STATUS_OPTIONS)[number] | undefined;
  direction?: (typeof DIRECTION_OPTIONS)[number] | undefined;
  economicMonth?: string | undefined;
  evidence?: "MISSING" | undefined;
};

/** The URL search each tile stands for; a tile is lit when the URL is exactly it. */
type Lens = "waiting" | "out" | "in" | "missing";

function lensSearch(lens: Lens, month: string): MoneySearch {
  switch (lens) {
    case "waiting":
      return { view: "waiting" };
    case "out":
      return { status: "LEDGER", direction: "EXPENSE", economicMonth: month };
    case "in":
      return { status: "LEDGER", direction: "REVENUE", economicMonth: month };
    case "missing":
      return { evidence: "MISSING" };
  }
}

function activeLens(search: MoneySearch & Record<string, unknown>): Lens | undefined {
  if (search.view === "waiting") return "waiting";
  if (search.evidence === "MISSING") return "missing";
  if (search.status === "LEDGER" && search.economicMonth !== undefined) {
    if (search.direction === "EXPENSE") return "out";
    if (search.direction === "REVENUE") return "in";
  }
  return undefined;
}

/** "octobre" / "October", with the year only when it is not this one. */
function useMonthName() {
  const { i18n } = useTranslation();
  return (code: string, { capitalize = false } = {}) => {
    const [year] = code.split("-");
    const date = new Date(`${code}-01T00:00:00Z`);
    const thisYear = String(new Date().getFullYear());
    const name = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      month: "long",
      ...(year === thisYear ? {} : { year: "numeric" }),
      timeZone: "UTC",
    }).format(date);
    return capitalize ? name.charAt(0).toLocaleUpperCase(i18n.resolvedLanguage) + name.slice(1) : name;
  };
}

/** Which month takes entries and which was closed last (#314). */
function MoneyLead({ summary }: { summary: FinanceSummaryResponse | undefined }) {
  const { t } = useTranslation();
  const monthName = useMonthName();
  if (summary === undefined) return null;
  const open = summary.openPeriodCode;
  const locked = summary.lastLockedPeriodCode;
  const text =
    open !== null && locked !== null
      ? t("finance.money.lead.both", {
          open: monthName(open, { capitalize: true }),
          locked: monthName(locked),
        })
      : open !== null
        ? t("finance.money.lead.open", { open: monthName(open, { capitalize: true }) })
        : t("finance.money.lead.none");
  return (
    <p data-slot="money-lead" className="mt-1 text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function MoneyTiles({
  summary,
  isPending,
  isError,
  ownOnly,
  canApprove,
  search,
  onLens,
}: {
  summary: FinanceSummaryResponse | undefined;
  canApprove: boolean;
  isPending: boolean;
  isError: boolean;
  ownOnly: boolean;
  search: MoneySearch & Record<string, unknown>;
  onLens: (search: MoneySearch) => void;
}) {
  const { t } = useTranslation();
  const monthName = useMonthName();
  const month = summary?.month;
  const current = activeLens(search);
  const select = (lens: Lens) => () =>
    onLens(current === lens || month === undefined ? {} : lensSearch(lens, month));
  const money = (minor: number | undefined) =>
    minor === undefined ? null : formatMoney(minor, { currency: summary?.currency ?? "XAF" });
  const monthLabel = month === undefined ? "" : monthName(month);

  const out: MetricTile = {
    label: t("finance.money.tiles.out", { month: monthLabel }),
    ...moneyMetric(summary?.outMinor, summary?.currency),
    onSelect: select("out"),
    selected: current === "out",
  };
  const waiting = summary?.waiting ?? undefined;
  const waitingTile: MetricTile | undefined =
    // role-config: only a decider has a queue; the server sends null otherwise.
    canApprove
      ? {
          label: t("finance.money.tiles.waiting"),
          value: waiting === undefined ? null : String(waiting.count),
          tone: waiting !== undefined && waiting.count > 0 ? "warning" : "neutral",
          ...(waiting !== undefined && waiting.count > 0
            ? {
                hint: t("finance.money.tiles.waitingHint", {
                  amount: money(waiting.amountMinor),
                  age: formatRelativeTime(waiting.oldestSubmittedAt),
                }),
              }
            : {}),
          onSelect: select("waiting"),
          selected: current === "waiting",
        }
      : undefined;
  const missing: MetricTile = {
    label: t("finance.money.tiles.missing"),
    value: summary === undefined ? null : String(summary.missingReceipt.count),
    ...(summary?.missingReceipt.oldestEconomicDate
      ? {
          hint: t("finance.money.tiles.missingHint", {
            date: formatDate(summary.missingReceipt.oldestEconomicDate),
          }),
        }
      : {}),
    onSelect: select("missing"),
    selected: current === "missing",
  };
  const incoming: MetricTile = {
    label: t("finance.money.tiles.in", { month: monthLabel }),
    ...moneyMetric(summary?.inMinor, summary?.currency),
    onSelect: select("in"),
    selected: current === "in",
  };

  // A driver's list is what they spent: no revenue to count (#264).
  const tiles: MetricTiles = ownOnly
    ? [out, missing]
    : waitingTile === undefined
      ? [out, missing, incoming]
      : [out, waitingTile, missing, incoming];

  return <MetricStrip className="mt-5" tiles={tiles} isPending={isPending} isError={isError} />;
}

/** The lens a tile set, named and removable, like the mockup's chip. */
function ActiveLensChip({
  search,
  waitingView,
  onClear,
}: {
  search: MoneySearch & Record<string, unknown>;
  waitingView: boolean;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const lens = activeLens(search);
  if (lens === undefined || (lens === "waiting" && !waitingView)) return null;
  const name = t(`finance.money.lens.${lens}`);
  return (
    <Button
      type="button"
      variant="secondary"
      aria-label={t("finance.money.lens.clear", { name })}
      onClick={onClear}
    >
      {name}
      <X aria-hidden />
    </Button>
  );
}
