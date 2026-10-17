import { useEffect } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
  FinanceOverviewResponse,
  FinanceSummaryResponse,
  FleetUsageResponse,
  OverviewRange,
  PeriodRead,
} from "@routiq/contracts";
import { CalendarCheck, CircleCheck, ClipboardCheck, ReceiptText, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { FilterChips } from "@/components/filter-chips";
import { MetricStrip, metricTiles, moneyMetric, type MetricTile } from "@/components/metric-strip.js";
import { CompareBars } from "@/components/overview/compare-bars.js";
import { RankedBars } from "@/components/overview/ranked-bars.js";
import { OverviewSummary } from "@/components/overview/overview-summary.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { InfoPopover } from "@/components/info-popover.js";
import { ErrorState } from "@/components/page";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CountedPopover } from "@/finance/CountedPopover.js";
import { canApproveEntries, canManagePeriods, canReadFinance, canReadMoneyOverview } from "@/finance/permissions.js";
import { useFinanceSummary } from "@/finance/useFinanceSummary.js";
import { useFleetUsage } from "@/overview/useFleetUsage.js";
import { useMoneyOverview } from "@/overview/useMoneyOverview.js";
import { windowLabel } from "@/overview/window-label.js";
import { usePeriods } from "@/finance/usePeriods.js";
import { monthName, moneySummaryText } from "@/overview/money-summary.js";
import { SummaryStatusBadge } from "@/overview/SummaryStatusBadge.js";
import {
  formatDate,
  formatDayMonth,
  formatMoney,
  formatMonth,
  formatPercent,
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
 * Money › Overview (#664, dashboards.html#money), journey-first like the Dashboard
 * (tools/verify/journeys/director-reads-money.ts): what waits comes first, then the
 * period's figures and what they leave out, then where spending moved. Tiles open
 * their tab already filtered.
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
  // role-config: fuel per km is vehicle money, read by the ledger roles; the cashier gets none, so never asks.
  const fuelShown = canReadFinance(me?.role, me?.enabledModules);
  const usageQuery = useFleetUsage(range, fuelShown);
  const words = overview === undefined ? undefined : moneySummaryText(overview, t, i18n.resolvedLanguage);

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
            {t("finance.overview.periodShort", { period: windows.periodShort, comparison: windows.comparisonShort })}
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

      {/* What waits leads; each row is one kind of work with its count and the verb that does it. */}
      <Card data-slot="money-todo">
        <CardHeader>
          <CardTitle>{t("finance.overview.todo.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
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
              limit={3}
            />
          )}
          {/* A locked month is a passed check: one line, so the closers know it is done (§9, locked periods). */}
          {canClose && lastMonth !== undefined && lastPeriod?.status === "LOCKED" && (
            <p data-slot="money-month-locked" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleCheck className="size-4 shrink-0 text-success-foreground" aria-hidden />
              {t("finance.overview.todo.monthLocked", { month: formatMonth(lastMonth, i18n.resolvedLanguage) })}
            </p>
          )}
        </CardContent>
      </Card>

      {/*
        The summary notice (#667) above the tiles when it is due. Its verdict
        (month, badge, reason) and what the figures leave out are its counted
        line: inside the notice when open, under the tiles when closed, so the
        completeness warning is at rest either way.
      */}
      <OverviewSummary
        page="money"
        notice={overview?.notice}
        sentence={words?.sentence}
        expensesUp={words?.expensesUp}
        counted={
          overview === undefined || words === undefined ? null : (
            <div data-slot="money-verdict" className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 desktop:min-h-8">
              {/* The summary reads its own month whatever the range, so the verdict names it (§9, period basis). */}
              <span data-slot="money-verdict-month" className="text-sm font-semibold text-foreground">
                {verdictMonth(overview.summary.period.from, i18n.resolvedLanguage)}
              </span>
              <SummaryStatusBadge {...words.badge} />
              {words.details.map((detail) => (
                <span key={detail} className="text-sm text-foreground">
                  {detail}
                </span>
              ))}
              {/*
                The period's pending total for every reader (§9, approval pending). An approver's To do
                row counts only what they may decide, so the line goes only when that row says the same.
              */}
              {overview.notCounted.waitingApproval.count > 0 &&
                !sameAsApproveRow(overview.notCounted.waitingApproval, canApprove ? summary?.waiting : undefined) && (
                <span data-slot="money-waiting" className="inline-flex items-center gap-1.5 text-sm font-medium text-warning-foreground">
                  <ClipboardCheck className="size-4" aria-hidden />
                  {t("finance.overview.counted.waitingShort", {
                    count: overview.notCounted.waitingApproval.count,
                    amount: formatMoney(overview.notCounted.waitingApproval.amountMinor, { currency: overview.currency }),
                  })}
                </span>
              )}
              <CountedPopover overview={overview} sentence={words.sentence} />
            </div>
          )
        }
      >
        <OverviewTiles
          overview={overview}
          summary={summary}
          isPending={overviewQuery.isPending || summaryQuery.isPending}
          isError={overviewQuery.isError || summaryQuery.isError}
          comparisonShort={windows?.comparisonShort}
        />
      </OverviewSummary>
      {/* The line holds its height while the read loads, so nothing below it jumps when it lands. */}
      {overviewQuery.isPending && <Skeleton className="-mt-1 h-11 w-72 desktop:h-8" />}

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryCard overview={overview} isPending={overviewQuery.isPending} windows={windows} />
        {fuelShown && (usageQuery.isPending || usageQuery.data?.money != null) && (
          <FuelPerKmCard usage={usageQuery.data} />
        )}
      </div>
    </div>
  );
}

/** The To do approve row shows this very count and amount, so a second line would repeat it. */
function sameAsApproveRow(
  waiting: FinanceOverviewResponse["notCounted"]["waitingApproval"],
  approveRow: FinanceSummaryResponse["waiting"] | undefined,
): boolean {
  return approveRow != null && approveRow.count === waiting.count && approveRow.amountMinor === waiting.amountMinor;
}

/** "October" / "Octobre": the month leads its line, so French capitalises it in the string, not in CSS (DS-4). */
function verdictMonth(isoDate: string, language: string | undefined): string {
  const month = monthName(isoDate, language);
  return month.charAt(0).toLocaleUpperCase(language) + month.slice(1);
}

/** A card header's link to the list behind it: 44 px on a phone, compact with a mouse. */
const CARD_LINK = "inline-flex min-h-11 items-center text-sm font-medium whitespace-nowrap underline-offset-4 hover:underline desktop:min-h-6";

type FuelNotCounted = "kmUnknown" | "noKm" | "noFuel";

/** Why a vehicle has no fuel per km: km not known, no km, or no fuel on file (the server's own rule). */
function fuelNotCounted(vehicle: FleetUsageResponse["vehicles"][number]): FuelNotCounted | null {
  if (vehicle.money?.fuelPerKmMinor != null) return null;
  if (vehicle.period === null || !vehicle.period.known) return "kmUnknown";
  if (vehicle.period.km <= 0) return "noKm";
  return "noFuel";
}

/**
 * Is any vehicle spending more on fuel than it should? (dashboards.html#money):
 * fuel per km by vehicle, highest first, against the fleet median; a vehicle
 * more than FUEL_OUTLIER_PERCENT above it is flagged. Vehicles with no fuel
 * per km are said as not counted, never drawn as 0.
 */
function FuelPerKmCard({ usage }: { usage: FleetUsageResponse | undefined }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const money = usage?.money ?? null;
  const currency = money?.currency ?? "XAF";
  const format = (minor: number) => formatMoney(minor, { currency });
  const vehicles = usage?.vehicles ?? [];
  const reasons = vehicles.map(fuelNotCounted);
  const count = (reason: FuelNotCounted) => reasons.filter((candidate) => candidate === reason).length;
  const notes = (["kmUnknown", "noKm", "noFuel"] as const)
    .filter((reason) => count(reason) > 0)
    .map((reason) => t(`finance.overview.fuel.notCounted.${reason}`, { count: count(reason) }));
  const rows = vehicles.flatMap((vehicle) => {
    const perKm = vehicle.money?.fuelPerKmMinor;
    if (perKm == null) return [];
    const above = vehicle.money?.fuelAboveMedianPercent ?? null;
    const trips = t("dashboard.vehicles.tripsCount", { count: vehicle.period?.tripsClosed ?? 0 });
    return [
      {
        key: vehicle.assetId,
        label: vehicle.assetCode,
        value: perKm,
        to: `/assets/${vehicle.assetId}`,
        flagged: above !== null,
        detail: above === null ? trips : t("finance.overview.fuel.detailAbove", { percent: formatPercent(above, language), tally: trips }),
      },
    ];
  });
  const median = money?.fuelPerKmMedianMinor ?? null;

  return (
    <Card data-slot="fuel-per-km-by-truck">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {t("finance.overview.fuel.title")}
          <InfoPopover label={t("finance.overview.fuel.basisLabel")}>
            {usage !== undefined && <p className="font-medium">{windowLabel(usage.period, usage.range, language)}</p>}
            <p>{t("finance.overview.fuel.basis")}</p>
          </InfoPopover>
        </CardTitle>
        <CardAction>
          <Link to="/assets/list" className={CARD_LINK}>
            {t("finance.overview.fuel.open")}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {usage === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("finance.overview.fuel.empty")}</p>
        ) : (
          <RankedBars
            rows={rows}
            format={format}
            {...(median === null ? {} : { reference: { value: median, label: t("finance.overview.fuel.median", { amount: format(median) }) } })}
            flagLabel={t("finance.overview.fuel.above")}
            labelHeader={t("dashboard.vehicles.columns.vehicle")}
            valueHeader={t("finance.overview.fuel.valueHeader")}
            moreLabel={(hidden) => t("finance.overview.fuel.more", { count: hidden })}
          />
        )}
        {/* Vehicles left out are a warning at rest; which ones, one tap away. */}
        {notes.length > 0 && (
          <div data-slot="fuel-not-counted">
            <InfoPopover
              label={t("finance.overview.counted.incomplete")}
              trigger="text"
              className="text-warning-foreground"
              icon={<TriangleAlert className="size-4" aria-hidden />}
            >
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </InfoPopover>
          </div>
        )}
      </CardContent>
    </Card>
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

function useWindowLabels(overview: FinanceOverviewResponse | undefined) {
  const { i18n } = useTranslation();
  if (overview === undefined) return undefined;
  const language = i18n.resolvedLanguage;
  return {
    period: windowLabel(overview.period, overview.range, language),
    comparison: windowLabel(overview.comparison, overview.range, language),
    periodShort: windowLabel(overview.period, overview.range, language, "short"),
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

/**
 * The period's two figures. What waits (approvals, receipts, the month close) is
 * the To do above, never a second tile that says the same.
 */
function OverviewTiles({
  overview,
  summary,
  isPending,
  isError,
  comparisonShort,
}: {
  overview: FinanceOverviewResponse | undefined;
  summary: FinanceSummaryResponse | undefined;
  isPending: boolean;
  isError: boolean;
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

  const strip = metricTiles([ledgerTile("EXPENSE"), ledgerTile("REVENUE")]);
  if (strip === undefined) return null;
  return <MetricStrip tiles={strip} isPending={isPending} isError={isError} />;
}

/** Past this many, the close row counts the earlier unlocked months instead of naming each. */
const NAMED_UNLOCKED_MAX = 3;

/**
 * Under the month close: the earlier months still not locked when there are
 * any (#526), the month's entry count otherwise.
 */
export function closeHint(
  month: string,
  period: PeriodRead | undefined,
  unlocked: readonly string[] | undefined,
  t: Translate,
  language: string | undefined,
): Pick<MetricTile, "hint"> {
  const earlier = (unlocked ?? []).filter((code) => code < month);
  if (earlier.length > NAMED_UNLOCKED_MAX) {
    return { hint: t("finance.overview.monthClose.earlierMany", { count: earlier.length }) };
  }
  if (earlier.length > 0) {
    const months = new Intl.ListFormat(language, { type: "conjunction" }).format(
      earlier.map((code) => formatMonth(code, language)),
    );
    return { hint: t("finance.overview.monthClose.earlier", { count: earlier.length, months }) };
  }
  return period === undefined ? {} : { hint: t("finance.periods.entryCount", { count: period.entryCount }) };
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
        <CardAction>
          <Link to="/finance/entries" search={{ status: "LEDGER", direction: "EXPENSE", economicMonth }} className={CARD_LINK}>
            {t("finance.overview.categories.open")}
          </Link>
        </CardAction>
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
      </CardContent>
    </Card>
  );
}

/** Ranked by money: the approvals carry an amount, then receipts, then the month close. Each verb does the work. */
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
      detail:
        waiting.oldestSubmittedAt === null
          ? formatMoney(waiting.amountMinor, { currency: summary?.currency ?? "XAF" })
          : t("finance.money.tiles.waitingHint", {
              amount: formatMoney(waiting.amountMinor, { currency: summary?.currency ?? "XAF" }),
              date: formatDayMonth(waiting.oldestSubmittedAt, language),
            }),
      action: { label: t("finance.overview.todo.review"), to: "/finance/approve" },
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
      action: { label: t("finance.overview.todo.addReceipts"), to: "/finance/entries", search: { evidence: "MISSING" } },
    });
  }
  // Last month still open, or an earlier one never locked (#526): either way the books are not closed.
  const closeMonthCode = close?.month;
  if (closeMonthCode !== undefined) {
    const open = close?.period?.status === "OPEN";
    const earlier = (summary?.unlockedPeriodCodes ?? []).filter((code) => code < closeMonthCode);
    const { hint } = closeHint(closeMonthCode, close?.period, summary?.unlockedPeriodCodes, t, language);
    if (open || earlier.length > 0) {
      items.push({
        key: "close",
        icon: <CalendarCheck className="size-4" aria-hidden />,
        title: open ? t("finance.overview.todo.monthOpen", { month: formatMonth(closeMonthCode, language) }) : hint,
        ...(open && hint !== undefined ? { detail: hint } : {}),
        action: { label: t("finance.overview.todo.closeAction"), to: "/finance/periods" },
      });
    }
  }
  return items;
}
