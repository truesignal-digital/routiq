import { useEffect } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
  FinanceOverviewResponse,
  FinanceSummaryResponse,
  OverviewRange,
  PeriodRead,
} from "@routiq/contracts";
import { CalendarCheck, ClipboardCheck, ReceiptText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { FilterChips } from "@/components/filter-chips";
import { MetricStrip, metricTiles, moneyMetric, type MetricTile } from "@/components/metric-strip.js";
import { CompareBars } from "@/components/overview/compare-bars.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { canApproveEntries, canManagePeriods, canReadMoneyOverview } from "@/finance/permissions.js";
import { useFinanceSummary } from "@/finance/useFinanceSummary.js";
import { useMoneyOverview } from "@/finance/useMoneyOverview.js";
import { usePeriods } from "@/finance/usePeriods.js";
import {
  formatDate,
  formatMoney,
  formatMonth,
  formatPercent,
  formatRelativeTime,
  localizedLabel,
} from "@/lib/format.js";

/** The range picker's choices as the address spells them; this month is the bare `/finance`. */
export const OVERVIEW_RANGE_PARAMS = ["3-months", "12-months"] as const;
export type OverviewRangeParam = (typeof OVERVIEW_RANGE_PARAMS)[number];

const RANGE_FROM_PARAM: Record<OverviewRangeParam, OverviewRange> = {
  "3-months": "THREE_MONTHS",
  "12-months": "TWELVE_MONTHS",
};

const RANGE_CHIPS = [
  { key: "month", range: "THIS_MONTH", param: undefined },
  { key: "3-months", range: "THREE_MONTHS", param: "3-months" },
  { key: "12-months", range: "TWELVE_MONTHS", param: "12-months" },
] as const satisfies readonly { key: string; range: OverviewRange; param: OverviewRangeParam | undefined }[];

type RangeChip = (typeof RANGE_CHIPS)[number]["key"];

/**
 * Money › Overview (#664, dashboards.html#money): how the period went, where
 * spending changed and what waits. Tiles open their tab already filtered.
 */
export function FinanceOverviewScreen() {
  const navigate = useNavigate();
  const me = useMeContext();
  // role-config: the overview read's own roles; a driver opens on Entries.
  const allowed = canReadMoneyOverview(me?.role, me?.enabledModules);
  useEffect(() => {
    if (me !== undefined && !allowed) void navigate({ to: "/finance/entries", replace: true });
  }, [me, allowed, navigate]);
  if (!allowed) return null;
  return <MoneyOverview />;
}

function MoneyOverview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const search: { range?: OverviewRangeParam | undefined } = useSearch({ strict: false });
  const range = search.range === undefined ? "THIS_MONTH" : RANGE_FROM_PARAM[search.range];
  const chip: RangeChip = search.range ?? "month";
  const overviewQuery = useMoneyOverview(range);
  const overview = overviewQuery.data;
  const summaryQuery = useFinanceSummary();
  const summary = summaryQuery.data;
  // role-config: the queue is a decider's, the month close the roles that lock it.
  const canApprove = canApproveEntries(me?.role, me?.enabledModules);
  const canClose = canManagePeriods(me?.role, me?.enabledModules);
  const periodsQuery = usePeriods(canClose);
  const lastMonth = closeMonth(periodsQuery.data?.currentPeriodCode);
  const lastPeriod = periodsQuery.data?.periods.find((period) => period.periodCode === lastMonth);
  const windows = useWindowLabels(overview);

  return (
    <div data-slot="money-overview" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          label={t("finance.overview.range.label")}
          value={chip}
          options={RANGE_CHIPS.map((option) => ({ key: option.key, label: t(`finance.overview.range.${option.key}`) }))}
          onChange={(key) => {
            const option = RANGE_CHIPS.find((candidate) => candidate.key === key);
            void navigate({ to: "/finance", search: option?.param === undefined ? {} : { range: option.param } });
          }}
        />
        {windows !== undefined && (
          <p data-slot="money-overview-period" className="text-sm text-muted-foreground">
            {t("finance.overview.period", { period: windows.period, comparison: windows.comparison })}
          </p>
        )}
      </div>

      {overviewQuery.isError && (
        <ErrorState
          message={t("finance.overview.loadFailed")}
          retryLabel={t("finance.entries.retry")}
          onRetry={() => void overviewQuery.refetch()}
        />
      )}

      <OverviewTiles
        overview={overview}
        summary={summary}
        isPending={overviewQuery.isPending || summaryQuery.isPending}
        isError={overviewQuery.isError || summaryQuery.isError}
        canApprove={canApprove}
        close={canClose ? { month: lastMonth, period: lastPeriod, isPending: periodsQuery.isPending } : undefined}
        comparisonShort={windows?.comparisonShort}
      />
      {overview !== undefined && <CountedLine overview={overview} />}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <CategoryCard overview={overview} isPending={overviewQuery.isPending} windows={windows} />
        {/* On a phone people act first: To do comes before the chart. */}
        <Card className="order-first lg:order-none">
          <CardHeader>
            <CardTitle>{t("finance.overview.todo.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryQuery.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ToDoList
                items={toDoItems({
                  summary,
                  canApprove,
                  close: canClose ? { month: lastMonth, period: lastPeriod } : undefined,
                  t,
                  language: i18n.resolvedLanguage,
                })}
                empty={t("finance.overview.todo.empty")}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** The month before the current one: the month a close is due for. */
export function closeMonth(current: string | undefined): string | undefined {
  if (current === undefined) return undefined;
  const [year, month] = current.split("-").map(Number);
  if (year === undefined || month === undefined) return undefined;
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** "October 1 – 10" for a month so far, "July – September 2026" for whole months. */
export function windowLabel(
  window: { from: string; to: string },
  range: OverviewRange,
  language: string | undefined,
  style: "long" | "short" = "long",
): string {
  const options: Intl.DateTimeFormatOptions =
    range === "THIS_MONTH"
      ? { month: style, day: "numeric", timeZone: "UTC" }
      : { month: style, year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(language, options).formatRange(utcDate(window.from), utcDate(window.to));
}

function useWindowLabels(overview: FinanceOverviewResponse | undefined) {
  const { i18n } = useTranslation();
  if (overview === undefined) return undefined;
  const language = i18n.resolvedLanguage;
  return {
    period: windowLabel(overview.period, overview.range, language),
    comparison: windowLabel(overview.comparison, overview.range, language),
    comparisonShort: windowLabel(overview.comparison, overview.range, language, "short"),
  };
}

/**
 * "▲ 11% vs Sep 1 – 9": the change against the same days of the comparison
 * window, arrow and words so colour is never alone. A change that rounds to
 * no percent, or from nothing, shows the amount instead (dashboards.html,
 * comparison rules).
 */
export function changeHint(
  current: number,
  previous: number,
  comparison: string,
  currency: string,
  t: Translate,
  language: string | undefined,
): string {
  if (current === previous) return t("finance.overview.change.same", { period: comparison });
  const arrow = current > previous ? "▲" : "▼";
  const percent = previous > 0 ? Math.round((Math.abs(current - previous) / previous) * 100) : 0;
  const change =
    percent > 0
      ? formatPercent(percent, language)
      : formatMoney(Math.abs(current - previous), { currency });
  return t("finance.overview.change.moved", { arrow, change, period: comparison });
}

interface CloseState {
  month: string | undefined;
  period: PeriodRead | undefined;
}

function OverviewTiles({
  overview,
  summary,
  isPending,
  isError,
  canApprove,
  close,
  comparisonShort,
}: {
  overview: FinanceOverviewResponse | undefined;
  summary: FinanceSummaryResponse | undefined;
  isPending: boolean;
  isError: boolean;
  canApprove: boolean;
  close: (CloseState & { isPending: boolean }) | undefined;
  comparisonShort: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const currency = overview?.currency ?? summary?.currency ?? "XAF";
  // A month so far filters the list to that month; whole months filter by kind only.
  const economicMonth = overview?.range === "THIS_MONTH" ? overview.period.from.slice(0, 7) : undefined;
  const hint = (current: number, previous: number) =>
    comparisonShort === undefined
      ? undefined
      : changeHint(current, previous, comparisonShort, currency, t, i18n.resolvedLanguage);

  const ledgerTile = (direction: "EXPENSE" | "REVENUE"): MetricTile => {
    const key = direction === "EXPENSE" ? "expenseMinor" : "revenueMinor";
    const value = overview?.period[key];
    const changed = overview === undefined ? undefined : hint(overview.period[key], overview.comparison[key]);
    return {
      id: direction === "EXPENSE" ? "expenses" : "revenue",
      label: t(direction === "EXPENSE" ? "finance.overview.tiles.expenses" : "finance.overview.tiles.revenue"),
      ...moneyMetric(value, currency),
      ...(changed === undefined ? {} : { hint: changed }),
      link: { to: "/finance/entries", search: { status: "LEDGER", direction, economicMonth } },
    };
  };

  const waiting = summary?.waiting ?? undefined;
  const tiles: MetricTile[] = [ledgerTile("EXPENSE"), ledgerTile("REVENUE")];
  if (canApprove) {
    tiles.push({
      id: "approve",
      label: t("finance.overview.tiles.approve"),
      value: waiting === undefined ? null : String(waiting.count),
      tone: waiting !== undefined && waiting.count > 0 ? "warning" : "neutral",
      ...(waiting !== undefined && waiting.count > 0
        ? {
            hint: t("finance.money.tiles.waitingHint", {
              amount: formatMoney(waiting.amountMinor, { currency }),
              age: formatRelativeTime(waiting.oldestSubmittedAt),
            }),
          }
        : {}),
      link: { to: "/finance/approve" },
    });
  }
  const missing = summary?.missingReceipt;
  tiles.push({
    id: "missing",
    label: t("finance.money.tiles.missing"),
    value: missing === undefined ? null : String(missing.count),
    ...(missing?.oldestEconomicDate
      ? { hint: t("finance.money.tiles.missingHint", { date: formatDate(missing.oldestEconomicDate) }) }
      : {}),
    link: { to: "/finance/entries", search: { evidence: "MISSING" } },
  });
  if (close !== undefined && close.month !== undefined) {
    const period = close.period;
    tiles.push({
      id: "close",
      label: t("finance.overview.tiles.monthClose", { month: formatMonth(close.month, i18n.resolvedLanguage) }),
      value: close.isPending
        ? null
        : t(
            period === undefined
              ? "finance.overview.monthClose.none"
              : period.status === "LOCKED"
                ? "finance.overview.monthClose.locked"
                : "finance.overview.monthClose.open",
          ),
      ...(period === undefined ? {} : { hint: t("finance.periods.entryCount", { count: period.entryCount }) }),
      link: { to: "/finance/entries", search: { periodCode: close.month } },
    });
  }

  const strip = metricTiles(tiles);
  if (strip === undefined) return null;
  return <MetricStrip tiles={strip} isPending={isPending} isError={isError} />;
}

/**
 * What the figures are made of and what they leave out, one sentence each, so
 * a missing receipt or an open trip never passes for a complete month.
 */
function CountedLine({ overview }: { overview: FinanceOverviewResponse }) {
  const { t } = useTranslation();
  const { counted, notCounted, currency } = overview;
  const sentences = [
    t("finance.overview.counted.posted", { count: counted.postedEntries }),
    notCounted.waitingApproval.count > 0
      ? t("finance.overview.counted.waiting", {
          count: notCounted.waitingApproval.count,
          amount: formatMoney(notCounted.waitingApproval.amountMinor, { currency }),
        })
      : null,
    notCounted.missingReceipt.count > 0
      ? t("finance.overview.counted.missingReceipt", { count: notCounted.missingReceipt.count })
      : null,
    notCounted.openTrips !== null && notCounted.openTrips > 0
      ? t("finance.overview.counted.openTrips", { count: notCounted.openTrips })
      : null,
    notCounted.otherCurrencyEntries > 0
      ? t("finance.overview.counted.otherCurrency", { count: notCounted.otherCurrencyEntries })
      : null,
  ].filter((sentence): sentence is string => sentence !== null);
  return (
    <p data-slot="money-counted" className="-mt-2 text-xs text-muted-foreground">
      {sentences.join(" ")}
    </p>
  );
}

function CategoryCard({
  overview,
  isPending,
  windows,
}: {
  overview: FinanceOverviewResponse | undefined;
  isPending: boolean;
  windows: ReturnType<typeof useWindowLabels>;
}) {
  const { t, i18n } = useTranslation();
  const currency = overview?.currency ?? "XAF";
  const economicMonth = overview?.range === "THIS_MONTH" ? overview.period.from.slice(0, 7) : undefined;
  const rows = (overview?.expensesByCategory ?? []).map((category) => ({
    key: category.code,
    label: localizedLabel(category, i18n.resolvedLanguage),
    value: category.period.expenseMinor,
    comparison: category.comparison.expenseMinor,
  }));

  return (
    <Card data-slot="money-categories">
      <CardHeader>
        <CardTitle>{t("finance.overview.categories.title")}</CardTitle>
        <CardDescription>
          {windows === undefined
            ? t("finance.overview.categories.question")
            : t("finance.overview.categories.description", {
                period: windows.period,
                comparison: windows.comparison,
              })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : overview === undefined ? null : rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("finance.overview.categories.empty")}</p>
        ) : (
          <CompareBars
            rows={rows}
            format={(minor) => formatMoney(minor, { currency })}
            periodLabel={windows?.period ?? ""}
            comparisonLabel={windows?.comparison ?? ""}
            comparisonText={(amount) => t("finance.overview.categories.versus", { amount })}
            otherLabel={(count) => t("finance.overview.categories.other", { count })}
          />
        )}
        <div className="mt-4 flex justify-end">
          <Link
            to="/finance/entries"
            search={{ status: "LEDGER", direction: "EXPENSE", economicMonth }}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("finance.overview.categories.open")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** Ranked by money: the approvals carry an amount, then receipts, then the month close. */
function toDoItems({
  summary,
  canApprove,
  close,
  t,
  language,
}: {
  summary: FinanceSummaryResponse | undefined;
  canApprove: boolean;
  close: CloseState | undefined;
  t: Translate;
  language: string | undefined;
}): ToDoItem[] {
  const items: ToDoItem[] = [];
  const waiting = summary?.waiting;
  if (canApprove && waiting != null && waiting.count > 0) {
    items.push({
      key: "approve",
      icon: <ClipboardCheck className="size-4" aria-hidden />,
      title: t("finance.overview.todo.approve", { count: waiting.count }),
      detail: t("finance.money.tiles.waitingHint", {
        amount: formatMoney(waiting.amountMinor, { currency: summary?.currency ?? "XAF" }),
        age: formatRelativeTime(waiting.oldestSubmittedAt),
      }),
      action: { label: t("finance.overview.todo.openApprove"), to: "/finance/approve" },
    });
  }
  const missing = summary?.missingReceipt;
  if (missing !== undefined && missing.count > 0) {
    items.push({
      key: "missing",
      icon: <ReceiptText className="size-4" aria-hidden />,
      title: t("finance.overview.todo.missing", { count: missing.count }),
      ...(missing.oldestEconomicDate
        ? { detail: t("finance.money.tiles.missingHint", { date: formatDate(missing.oldestEconomicDate) }) }
        : {}),
      action: { label: t("finance.overview.todo.openEntries"), to: "/finance/entries", search: { evidence: "MISSING" } },
    });
  }
  if (close?.month !== undefined && close.period?.status === "OPEN") {
    items.push({
      key: "close",
      icon: <CalendarCheck className="size-4" aria-hidden />,
      title: t("finance.overview.todo.closeMonth", { month: formatMonth(close.month, language) }),
      detail: t("finance.periods.entryCount", { count: close.period.entryCount }),
      action: { label: t("finance.overview.todo.review"), to: "/finance/periods" },
    });
  }
  return items;
}
