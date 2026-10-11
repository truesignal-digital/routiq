import type { ReactNode } from "react";
import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import type { AssetSummary, FinanceOverviewResponse, FleetUsageResponse } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { useAssetSummary } from "@/assets/useAssetSummary.js";
import { FilterChips } from "@/components/filter-chips";
import { MetricStrip, metricTiles, moneyMetric, type MetricTile } from "@/components/metric-strip.js";
import { CompareBars } from "@/components/overview/compare-bars.js";
import { OverviewSummary } from "@/components/overview/overview-summary.js";
import { ToDoList } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { comingUpLine, ComingUpIcon, todoItem } from "@/dashboard/attention-words.js";
import { rangeFromParam, type DashboardRangeParam } from "@/dashboard/tabs.js";
import { useComingUp, useTodo } from "@/dashboard/useFleetAttention.js";
import { BranchProfitBars, BranchProfitTable, branchRows } from "@/finance/dashboard/BranchProfit.js";
import { profitBridge } from "@/finance/dashboard/bridge.js";
import { MoneyMonthsChart } from "@/finance/dashboard/MoneyMonthsChart.js";
import { dashboardMode, vehicleRows, vehiclesAtALoss, type DashboardMode } from "@/finance/dashboard/money-view.js";
import { ProfitBridge } from "@/finance/dashboard/ProfitBridge.js";
import { CompanyLinesList, VehicleProfitTable, VehiclesAtALoss } from "@/finance/dashboard/VehicleProfit.js";
import { useFleetUsage } from "@/overview/useFleetUsage.js";
import { moneySummaryText } from "@/overview/money-summary.js";
import { SummaryStatusBadge } from "@/overview/SummaryStatusBadge.js";
import { useMoneyOverview } from "@/overview/useMoneyOverview.js";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatMoney, formatPercent, localizedLabel, profitOrLoss } from "@/lib/format.js";
import { contributes } from "@/modules/manifest.js";
import { useAmbientBranchId } from "@/shell/branch-context.js";
import { windowLabel } from "@/overview/window-label.js";
import { changeHint } from "./FinanceOverviewScreen.js";

/** Vehicle rows on the Overview's card; the tab lists every one. */
const OVERVIEW_VEHICLE_ROWS = 5;

const RANGE_CHIPS = [
  { key: "month", param: undefined },
  { key: "3-months", param: "3-months" },
  { key: "12-months", param: "12-months" },
] as const satisfies readonly { key: string; param: DashboardRangeParam | undefined }[];

type Translate = ReturnType<typeof useTranslation>["t"];

/** The money read for the range in the address and the shell's branch, with what every tab derives from it. */
function useDashboardMoney() {
  const search: { range?: DashboardRangeParam | undefined } = useSearch({ strict: false });
  const query = useMoneyOverview(rangeFromParam(search.range));
  const branchId = useAmbientBranchId();
  const overview = query.data;
  return { query, overview, branchId, mode: dashboardMode(overview), range: search.range };
}

function useWindows(overview: FinanceOverviewResponse | undefined) {
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

/** The range picker and the window it reads, the same on every money tab; changing it keeps the tab. */
function RangeBar({ overview, range }: { overview: FinanceOverviewResponse | undefined; range: DashboardRangeParam | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const windows = useWindows(overview);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <FilterChips
        label={t("finance.overview.range.label")}
        value={range ?? "month"}
        options={RANGE_CHIPS.map((option) => ({ key: option.key, label: t(`finance.overview.range.${option.key}`) }))}
        onChange={(key) => {
          const option = RANGE_CHIPS.find((candidate) => candidate.key === key);
          void navigate({ to: pathname, search: option?.param === undefined ? {} : { range: option.param } });
        }}
      />
      {windows !== undefined && (
        <p data-slot="dashboard-period" className="text-sm text-muted-foreground">
          {t("finance.overview.period", { period: windows.period, comparison: windows.comparison })}
        </p>
      )}
    </div>
  );
}

function OverviewError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return <ErrorState message={t("dashboard.loadFailed")} retryLabel={t("home.retry")} onRetry={onRetry} />;
}

/**
 * Dashboard › Overview (#666, dashboards.html#home): are we making money, what
 * changed it, what needs me. Branch and range change every region except To
 * do and Coming up, which count the whole Branch Scope. A company with no
 * revenue (an internal fleet) sees its expenses and costs, never a profit.
 */
export function DashboardOverviewTab() {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const me = useMeContext();
  const { query, overview, branchId, mode, range } = useDashboardMoney();
  const windows = useWindows(overview);
  // role-config: the vehicles tile is the Vehicles module's, as on Home.
  const showFleet = contributes("homeCards", "assets", me?.enabledModules);
  const fleet = useAssetSummary({}, showFleet);
  // Cost per km for the same range: a fleet figure, read with the fleet (#668).
  const usage = useFleetUsage(rangeFromParam(range), showFleet);
  const todo = useTodo();
  const rows = overview === undefined ? [] : vehicleRows(overview, branchId);
  const steps = overview === undefined || mode !== "profit" ? undefined : profitBridge(overview);
  const words = overview === undefined ? undefined : moneySummaryText(overview, t, i18n.resolvedLanguage);

  return (
    <div data-slot="dashboard-overview" data-mode={mode} className="flex flex-col gap-5">
      <RangeBar overview={overview} range={range} />
      {query.isError && <OverviewError onRetry={() => void query.refetch()} />}

      <OverviewSummary
        page="dashboard"
        notice={overview?.notice}
        sentence={words?.sentence}
        details={words?.details}
        badge={words === undefined ? undefined : <SummaryStatusBadge {...words.badge} />}
        expensesUp={words?.expensesUp}
        counted={overview === undefined ? null : <CountedLine overview={overview} mode={mode} />}
      >
        <OverviewTiles
          overview={overview}
          mode={mode}
          fleet={showFleet ? fleet.data : undefined}
          showFleet={showFleet}
          usage={showFleet ? usage.data : undefined}
          isPending={query.isPending || (showFleet && fleet.isPending)}
          isError={query.isError}
          comparisonShort={windows?.comparisonShort}
        />
      </OverviewSummary>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card data-slot="dashboard-why">
          <CardHeader>
            <CardTitle>{t(mode === "profit" ? "dashboard.bridge.title" : "dashboard.categories.title")}</CardTitle>
            <CardDescription>
              {windows === undefined || overview === undefined
                ? t(mode === "profit" ? "dashboard.bridge.question" : "dashboard.categories.question")
                : t(mode === "profit" ? "dashboard.bridge.description" : "dashboard.categories.description", {
                    comparison: windows.comparisonShort,
                    period: windows.periodShort,
                    currency: overview.currency,
                  })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview === undefined ? (
              <Skeleton className="h-48 w-full" />
            ) : steps !== undefined && windows !== undefined ? (
              <ProfitBridge
                steps={steps}
                currency={overview.currency}
                periodLabel={windows.periodShort}
                comparisonLabel={windows.comparisonShort}
              />
            ) : (
              <CategoryChanges overview={overview} windows={windows} />
            )}
          </CardContent>
        </Card>

        {/* On a phone people act first: To do comes before any chart. */}
        <Card data-slot="dashboard-todo-card" className="order-first lg:order-none">
          <CardHeader>
            <CardTitle>{t("dashboard.todo.title")}</CardTitle>
            <CardDescription>{t("dashboard.todo.description")}</CardDescription>
            {todo.data !== undefined && todo.data.totalCount > 0 && (
              <CardAction>
                <CardLink to="/to-do">{t("dashboard.todo.seeAll", { count: todo.data.totalCount })}</CardLink>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {todo.isError ? (
              <ErrorState
                message={t("dashboard.todo.loadFailed")}
                retryLabel={t("home.retry")}
                onRetry={() => void todo.refetch()}
              />
            ) : todo.data === undefined ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <ToDoList
                items={todo.data.rows.map((row) => todoItem(row, t, i18n.resolvedLanguage))}
                empty={t("dashboard.todo.empty")}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-slot="dashboard-vehicles-card">
        <CardHeader>
          <CardTitle>
            {t(isMobile && mode === "profit" ? "dashboard.vehicles.atALossTitle" : `dashboard.vehicles.title.${mode}`)}
          </CardTitle>
          <CardDescription>
            {windows === undefined
              ? null
              : t(`dashboard.vehicles.description.${mode}`, { period: windows.periodShort })}
          </CardDescription>
          <CardAction>
            <CardLink to="/profit-by-vehicle" range={range}>
              {t("dashboard.openTab")}
            </CardLink>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {overview === undefined ? (
            <Skeleton className="h-48 w-full" />
          ) : overview.vehicles === null ? (
            <p className="py-2 text-sm text-muted-foreground">{t("dashboard.vehicles.unavailable")}</p>
          ) : isMobile && mode === "profit" ? (
            <VehiclesAtALoss rows={vehiclesAtALoss(rows)} currency={overview.currency} />
          ) : (
            <>
              <VehicleProfitTable
                overview={overview}
                rows={rows}
                mode={mode}
                limit={isMobile ? 3 : OVERVIEW_VEHICLE_ROWS}
              />
              {!isMobile && (
                <CompanyLinesList overview={overview} rows={rows} mode={mode} branchChosen={branchId !== undefined} />
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-slot="dashboard-months">
          <CardHeader>
            <CardTitle>{t(`dashboard.months.title.${mode}`)}</CardTitle>
            <CardDescription>{t(`dashboard.months.description.${mode}`, { currency: overview?.currency ?? "XAF" })}</CardDescription>
            <CardAction>
              <CardLink to="/finance">{t("dashboard.months.open")}</CardLink>
            </CardAction>
          </CardHeader>
          <CardContent>
            {overview === undefined ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <MoneyMonthsChart series={overview.series} currency={overview.currency} mode={mode} />
            )}
          </CardContent>
        </Card>
        <Card data-slot="dashboard-branches-card">
          <CardHeader>
            <CardTitle>{t(`dashboard.branches.title.${mode}`)}</CardTitle>
            <CardDescription>
              {windows === undefined || overview === undefined
                ? null
                : t(`dashboard.branches.description.${mode}`, { period: windows.periodShort, currency: overview.currency })}
            </CardDescription>
            <CardAction>
              <CardLink to="/profit-by-branch" range={range}>
                {t("dashboard.openTab")}
              </CardLink>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {overview === undefined ? (
              <Skeleton className="h-32 w-full" />
            ) : overview.branches === null ? (
              <p className="py-2 text-sm text-muted-foreground">{t("dashboard.vehicles.unavailable")}</p>
            ) : (
              <>
                <BranchProfitBars rows={branchRows(overview, branchId)} currency={overview.currency} mode={mode} />
                <CompanyCostsNote overview={overview} />
              </>
            )}
          </CardContent>
        </Card>
        <ComingUpCard />
      </div>
    </div>
  );
}

/** A card header's link to the page behind it; the money tabs keep the range. */
function CardLink({ to, range, children }: { to: string; range?: DashboardRangeParam | undefined; children: ReactNode }) {
  return (
    <Link
      to={to}
      search={range === undefined ? {} : { range }}
      className="text-sm font-medium whitespace-nowrap underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

/**
 * Revenue, expenses, profit and the vehicles that can drive, each against the
 * same days of the comparison window; an internal fleet gets expenses, vehicle
 * costs and company costs instead. Four tiles: two by two on a phone.
 */
function OverviewTiles({
  overview,
  mode,
  fleet,
  showFleet,
  usage,
  isPending,
  isError,
  comparisonShort,
}: {
  overview: FinanceOverviewResponse | undefined;
  mode: DashboardMode;
  fleet: AssetSummary | undefined;
  showFleet: boolean;
  /** The km read for the range; its money is null when Trips or Money is off. */
  usage: FleetUsageResponse | undefined;
  isPending: boolean;
  isError: boolean;
  comparisonShort: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const currency = overview?.currency ?? "XAF";
  const economicMonth = overview?.range === "THIS_MONTH" ? overview.period.from.slice(0, 7) : undefined;
  const moved = (current: number, previous: number) =>
    comparisonShort === undefined ? undefined : changeHint(current, previous, comparisonShort, currency, t, language);

  const moneyTile = (
    id: string,
    label: string,
    current: number | undefined,
    previous: number | undefined,
    link?: MetricTile["link"],
  ): MetricTile => {
    const hint = current === undefined || previous === undefined ? undefined : moved(current, previous);
    return {
      id,
      label,
      ...moneyMetric(current, currency),
      ...(hint === undefined ? {} : { hint }),
      ...(link === undefined ? {} : { link }),
    };
  };
  const entriesLink = (direction: "EXPENSE" | "REVENUE") => ({
    to: "/finance/entries",
    search: { status: "LEDGER", direction, economicMonth },
  });

  const tiles: MetricTile[] = [];
  const company = overview?.companyProfit;
  if (mode === "profit") {
    tiles.push(
      moneyTile("revenue", t("dashboard.tiles.revenue"), overview?.period.revenueMinor, overview?.comparison.revenueMinor, entriesLink("REVENUE")),
      moneyTile("expenses", t("dashboard.tiles.expenses"), overview?.period.expenseMinor, overview?.comparison.expenseMinor, entriesLink("EXPENSE")),
      profitTile(overview, comparisonShort, t, language),
    );
  } else {
    const vehicleCost = (window: "period" | "comparison") =>
      overview === undefined || company == null
        ? undefined
        : overview[window].expenseMinor - company[window].companyCostsMinor;
    tiles.push(
      moneyTile("expenses", t("dashboard.tiles.expenses"), overview?.period.expenseMinor, overview?.comparison.expenseMinor, entriesLink("EXPENSE")),
      moneyTile("vehicleCosts", t("dashboard.tiles.vehicleCosts"), vehicleCost("period"), vehicleCost("comparison")),
      moneyTile(
        "companyCosts",
        t("dashboard.tiles.companyCosts"),
        company?.period.companyCostsMinor,
        company?.comparison.companyCostsMinor,
      ),
    );
  }
  if (usage?.money != null) tiles.push(costPerKmTile(usage, usage.money, comparisonShort, t, language));
  if (showFleet) {
    const grounded = fleet === undefined ? 0 : fleet.inService - fleet.canDrive;
    tiles.push({
      id: "canDrive",
      label: t("dashboard.tiles.canDrive"),
      value: fleet === undefined ? null : t("dashboard.tiles.canDriveValue", { count: fleet.canDrive, total: fleet.inService }),
      ...(fleet === undefined
        ? {}
        : {
            hint:
              fleet.inService === 0
                ? t("dashboard.tiles.noneInService")
                : grounded > 0
                  ? t("dashboard.tiles.offTheRoad", { count: grounded })
                  : t("dashboard.tiles.allCanDrive"),
          }),
      tone: grounded > 0 ? "warning" : "neutral",
      link: { to: "/assets" },
    });
  }
  const strip = metricTiles(tiles);
  if (strip === undefined) return null;
  return <MetricStrip tiles={strip} isPending={isPending} isError={isError} />;
}

/**
 * Cost per km (dashboards.html#home): expenses ÷ km over the vehicles whose
 * both are known, against the comparison window (an increase is the bad
 * way). Without a comparison it says whose km are known instead.
 */
function costPerKmTile(
  usage: FleetUsageResponse,
  money: NonNullable<FleetUsageResponse["money"]>,
  comparisonShort: string | undefined,
  t: Translate,
  language: string | undefined,
): MetricTile {
  const current = money.period.costPerKmMinor;
  const previous = money.comparison.costPerKmMinor;
  const amount = moneyMetric(current, money.currency);
  const known = usage.km?.period;
  const hint =
    current !== null && previous !== null && comparisonShort !== undefined
      ? changeHint(current, previous, comparisonShort, money.currency, t, language)
      : known === undefined
        ? undefined
        : t("overview.usage.kmKnown", { known: known.knownVehicles, total: known.vehicles });
  return {
    id: "cost-per-km",
    label: t("dashboard.tiles.costPerKm"),
    ...amount,
    ...(amount.unit === undefined ? {} : { unit: t("dashboard.tiles.perKmUnit", { unit: amount.unit }) }),
    ...(hint === undefined ? {} : { hint }),
    info: t("dashboard.tiles.costPerKmInfo", { count: money.period.vehicles }),
  };
}

/** "Profit 1 870 000 XAF · ▼ 100 000 vs Sep 1–9 · 20% of revenue"; a loss is called a loss. */
function profitTile(
  overview: FinanceOverviewResponse | undefined,
  comparisonShort: string | undefined,
  t: Translate,
  language: string | undefined,
): MetricTile {
  const current = overview?.period.profitMinor ?? undefined;
  const previous = overview?.comparison.profitMinor ?? undefined;
  const currency = overview?.currency ?? "XAF";
  const result = current === undefined ? undefined : profitOrLoss(current, { currency });
  const base: MetricTile = {
    id: "profit",
    label: result?.label ?? t("common.profit"),
    ...moneyMetric(current === undefined ? undefined : Math.abs(current), currency),
    ...(result?.kind === "loss" ? { tone: "warning" as const } : {}),
    link: { to: "/finance" },
  };
  if (current === undefined || previous === undefined || overview === undefined || comparisonShort === undefined) return base;
  const change =
    current === previous
      ? t("finance.overview.change.same", { period: comparisonShort })
      : t("finance.overview.change.moved", {
          arrow: current > previous ? "▲" : "▼",
          change: formatMoney(Math.abs(current - previous), { currency }),
          period: comparisonShort,
        });
  const revenue = overview.period.revenueMinor;
  if (revenue <= 0) return { ...base, hint: change };
  const share = formatPercent(Math.round((Math.abs(current) / revenue) * 100), language);
  return { ...base, hint: t("dashboard.tiles.profitHint", { change, share }) };
}

/**
 * What the figures are and what they leave out: profit is what was recorded
 * in ROUTIQ, then what was counted and what was not yet, so a missing receipt
 * or an open trip never passes for a complete month.
 */
function CountedLine({ overview, mode }: { overview: FinanceOverviewResponse; mode: DashboardMode }) {
  const { t } = useTranslation();
  const { counted, notCounted, currency } = overview;
  const sentences = [
    mode === "profit" ? t("dashboard.counted.profitMeans") : null,
    counted.closedTrips === null
      ? t("finance.overview.counted.posted", { count: counted.postedEntries })
      : t("dashboard.counted.postedAndTrips", { count: counted.postedEntries, closed: counted.closedTrips }),
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
    <span data-slot="dashboard-counted">{sentences.join(" ")}</span>
  );
}

/** The internal fleet's "why": each expense category against the comparison window. */
function CategoryChanges({
  overview,
  windows,
}: {
  overview: FinanceOverviewResponse;
  windows: ReturnType<typeof useWindows>;
}) {
  const { t, i18n } = useTranslation();
  const rows = overview.expensesByCategory.map((category) => ({
    key: category.code,
    label: localizedLabel(category, i18n.resolvedLanguage),
    value: category.period.expenseMinor,
    comparison: category.comparison.expenseMinor,
  }));
  if (rows.length === 0) return <p className="py-2 text-sm text-muted-foreground">{t("finance.overview.categories.empty")}</p>;
  return (
    <CompareBars
      rows={rows}
      format={(minor) => formatMoney(minor, { currency: overview.currency })}
      periodLabel={windows?.period ?? ""}
      comparisonLabel={windows?.comparison ?? ""}
      comparisonText={(amount) => t("finance.overview.categories.versus", { amount })}
      otherLabel={(count) => t("finance.overview.categories.other", { count })}
    />
  );
}

/** Company costs stay out of the branch figures, and the card says so with the amount. */
function CompanyCostsNote({ overview }: { overview: FinanceOverviewResponse }) {
  const { t } = useTranslation();
  const costs = overview.companyProfit?.period.companyCostsMinor;
  if (costs === undefined) return null;
  return (
    <p data-slot="company-costs-note" className="text-xs text-muted-foreground">
      {t("dashboard.branches.companyCostsNote", { amount: formatMoney(costs, { currency: overview.currency }) })}
    </p>
  );
}

/** What falls due in the next 14 days, across the whole Branch Scope, and what ROUTIQ could not count. */
function ComingUpCard() {
  const { t, i18n } = useTranslation();
  const comingUp = useComingUp(14);
  const data = comingUp.data;
  return (
    <Card data-slot="dashboard-coming-up">
      <CardHeader>
        <CardTitle>{t("dashboard.comingUp.title")}</CardTitle>
        <CardDescription>{t("dashboard.comingUp.description", { days: 14 })}</CardDescription>
      </CardHeader>
      <CardContent>
        {comingUp.isError ? (
          <ErrorState
            message={t("dashboard.comingUp.loadFailed")}
            retryLabel={t("home.retry")}
            onRetry={() => void comingUp.refetch()}
          />
        ) : data === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            {data.rows.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t("dashboard.comingUp.empty", { days: data.windowDays })}</p>
            ) : (
              <ul data-slot="coming-up-list" className="flex flex-col">
                {data.rows.map((row) => {
                  const line = comingUpLine(row, t, i18n.resolvedLanguage);
                  return (
                    <li key={line.key} className="border-b last:border-b-0">
                      <Link
                        to={line.to}
                        {...(line.search === undefined ? {} : { search: line.search })}
                        className="flex min-h-11 items-center gap-3 py-2 hover:bg-muted/50"
                      >
                        <ComingUpIcon icon={line.icon} />
                        <span className="min-w-0 flex-1 text-sm">{line.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{line.detail}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {data.notCounted.includes("SERVICE_DUE_BY_KM") && (
              <p data-slot="coming-up-not-counted" className="pt-3 text-xs text-muted-foreground">
                {t("dashboard.comingUp.notCounted.SERVICE_DUE_BY_KM")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Dashboard › Profit by vehicle: every vehicle, then the lines from all vehicles to company profit. */
export function DashboardVehiclesTab() {
  const { t } = useTranslation();
  const { query, overview, branchId, mode, range } = useDashboardMoney();
  const windows = useWindows(overview);
  const rows = overview === undefined ? [] : vehicleRows(overview, branchId);
  return (
    <div data-slot="dashboard-vehicles" data-mode={mode} className="flex flex-col gap-5">
      <RangeBar overview={overview} range={range} />
      {query.isError && <OverviewError onRetry={() => void query.refetch()} />}
      <Card>
        <CardHeader>
          <CardTitle>{t(`dashboard.vehicles.title.${mode}`)}</CardTitle>
          <CardDescription>
            {windows === undefined ? null : t(`dashboard.vehicles.description.${mode}`, { period: windows.periodShort })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {overview === undefined ? (
            <Skeleton className="h-64 w-full" />
          ) : overview.vehicles === null ? (
            <p className="py-2 text-sm text-muted-foreground">{t("dashboard.vehicles.unavailable")}</p>
          ) : (
            <>
              <VehicleProfitTable overview={overview} rows={rows} mode={mode} />
              <CompanyLinesList overview={overview} rows={rows} mode={mode} branchChosen={branchId !== undefined} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Dashboard › Profit by branch: each branch's vehicles, revenue, expenses and vehicle profit. */
export function DashboardBranchesTab() {
  const { t } = useTranslation();
  const { query, overview, branchId, mode, range } = useDashboardMoney();
  const windows = useWindows(overview);
  return (
    <div data-slot="dashboard-branches" data-mode={mode} className="flex flex-col gap-5">
      <RangeBar overview={overview} range={range} />
      {query.isError && <OverviewError onRetry={() => void query.refetch()} />}
      <Card>
        <CardHeader>
          <CardTitle>{t(`dashboard.branches.title.${mode}`)}</CardTitle>
          <CardDescription>
            {windows === undefined || overview === undefined
              ? null
              : t(`dashboard.branches.description.${mode}`, { period: windows.periodShort, currency: overview.currency })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {overview === undefined ? (
            <Skeleton className="h-48 w-full" />
          ) : overview.branches === null ? (
            <p className="py-2 text-sm text-muted-foreground">{t("dashboard.vehicles.unavailable")}</p>
          ) : (
            <>
              <BranchProfitTable rows={branchRows(overview, branchId)} currency={overview.currency} mode={mode} />
              <CompanyCostsNote overview={overview} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
