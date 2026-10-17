import type { ActivitySummary, FleetUsageResponse, FleetUsageRoute } from "@routiq/contracts";
import { Fuel, Gauge, Route, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InfoPopover } from "@/components/info-popover.js";
import { MetricStrip, metricTiles, type MetricTile } from "@/components/metric-strip.js";
import { RankedBars } from "@/components/overview/ranked-bars.js";
import { OverviewSummary } from "@/components/overview/overview-summary.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { WeekColumns } from "@/components/overview/week-columns.js";
import { ErrorState } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { currencyUnit, formatDate, formatDayMonth, formatMoney, formatPercent } from "@/lib/format.js";
import { PAGE_USAGE_RANGE, pointsChange, useFleetUsage, wholeShare } from "@/overview/useFleetUsage.js";
import { windowLabel } from "@/overview/window-label.js";
import { useActivitySummary } from "./useActivities.js";

type Translate = ReturnType<typeof useTranslation>["t"];

const LIST = "/activities/list";

function shortDay(iso: string, language: string | undefined): string {
  return formatDayMonth(iso, language, { month: "short" });
}

/**
 * Trips › Overview (#665, dashboards.html#trips), journey-first (tools/verify/journeys/
 * admin-checks-trips.ts): what is left to close comes first, then the figures, then
 * the weeks and the routes. Every tile, To do row and column opens the Trips tab
 * already filtered, so a number and its list always count the same trips. What the
 * figures leave out stays at rest: on the missing-data tile, and in the summary's counted line
 * while Money is off (under the tiles when the summary is closed).
 */
export function TripsOverview() {
  const { t, i18n } = useTranslation();
  const summaryQuery = useActivitySummary();
  const summary = summaryQuery.data;
  const usageQuery = useFleetUsage(PAGE_USAGE_RANGE);
  const usage = usageQuery.data;
  const language = i18n.resolvedLanguage;
  const tiles = metricTiles(tripTiles(summary, t, language, usage));
  // Revenue per km is vehicle money: only for the roles the server sends it to.
  const routes =
    usage?.money != null && usage.trips !== null ? <RoutesCard usage={usage} currency={usage.money.currency} trips={usage.trips} /> : null;

  return (
    <div data-slot="trips-overview" className="flex flex-col gap-5">
      {summaryQuery.isError && (
        <ErrorState
          message={t("activities.loadFailed")}
          retryLabel={t("activities.retry")}
          onRetry={() => void summaryQuery.refetch()}
        />
      )}

      {/* People act first: what is left to close leads, before any figure. */}
      <Card data-slot="trips-todo-card">
        <CardHeader>
          <CardTitle>{t("activities.overview.todo.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {summary === undefined ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ToDoList items={tripToDo(summary, t)} empty={t("activities.overview.todo.empty")} limit={3} />
          )}
        </CardContent>
      </Card>

      <OverviewSummary
        page="trips"
        notice={summary?.notice}
        sentence={summary === undefined ? undefined : t("activities.overview.summary.sentence", { started: summary.thisWeek, closed: summary.weekClosed })}
        details={summary === undefined ? undefined : [t("activities.overview.summary.open", { open: summary.open })]}
        counted={
          // Money off: fuel is a money fact, so the figures cannot count it, and say so at rest.
          // The missing fuel and km counts are on their own tile, so the line says nothing more.
          summary?.closedMissing.fuel === null ? (
            <span data-slot="trips-counted" className="flex items-center gap-1.5 text-warning-foreground">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {t("activities.overview.fuelNotCounted")}
            </span>
          ) : null
        }
      >
        {tiles !== undefined && <MetricStrip tiles={tiles} isPending={summaryQuery.isPending} isError={summaryQuery.isError} />}
      </OverviewSummary>

      <div className={routes === null ? "grid gap-4" : "grid gap-4 lg:grid-cols-2"}>
        <Card data-slot="trips-per-week">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              {t("activities.overview.weeks.title")}
              <InfoPopover label={t("common.howCalculated")}>
                {t("activities.overview.weeks.info", { count: summary?.weeks.length ?? 12 })}
              </InfoPopover>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <WeekColumns
                doneLabel={t("activities.overview.weeks.closed")}
                openLabel={t("activities.overview.weeks.open")}
                columns={summary.weeks.map((week) => ({
                  key: week.from,
                  label: shortDay(week.from, language),
                  total: week.started,
                  done: week.closed,
                  description: t("activities.overview.weeks.column", {
                    week: shortDay(week.from, language),
                    started: week.started,
                    closed: week.closed,
                  }),
                  link: { to: LIST, search: { from: week.from, to: week.to } },
                }))}
              />
            )}
            {/* This week's short column is still running: said at rest, so it isn't read as a slow week. */}
            <p data-slot="trips-week-partial" className="text-xs text-muted-foreground">
              {t("activities.overview.weeks.partial")}
            </p>
          </CardContent>
        </Card>
        {routes}
      </div>
    </div>
  );
}

/**
 * Five tiles (dashboards.html#trips): closed, open, km, km driven empty and
 * closed with missing data. Started this week reads in the weekly chart.
 */
export function tripTiles(
  summary: ActivitySummary | undefined,
  t: Translate,
  language: string | undefined,
  usage?: FleetUsageResponse | undefined,
): MetricTile[] {
  const week = summary?.week;
  const weekSearch = week === undefined ? {} : { from: week.from, to: week.to };
  const missing = summary?.closedMissing;
  const weekKm: MetricTile = {
    id: "week-km",
    label: t("activities.metrics.weekKm"),
    value:
      summary === undefined || summary.weekKm === null
        ? null
        : t("activities.metrics.weekKmValue", { km: summary.weekKm }),
    info: t("activities.metrics.weekKmHint"),
  };
  return [
    {
      id: "week-closed",
      label: t("activities.overview.tiles.weekClosed"),
      value: summary === undefined ? null : String(summary.weekClosed),
      // The basis stays at rest: the server counts only trips started this week, then closed.
      hint: t("activities.overview.tiles.weekClosedHint"),
      link: { to: LIST, search: { status: "CLOSED", ...weekSearch } },
    },
    {
      id: "open",
      label: t("activities.status.OPEN"),
      value: summary === undefined ? null : String(summary.open),
      ...(summary === undefined
        ? {}
        : {
            hint:
              summary.oldestOpen === null
                ? t("activities.overview.tiles.openNone")
                : t("activities.overview.tiles.openOldest", { date: formatDate(summary.oldestOpen.startedAt, language) }),
          }),
      link: { to: LIST, search: { status: "OPEN" } },
    },
    weekKm,
    ...(usage === undefined || usage.trips !== null ? [emptyKmTile(usage, t, language)] : []),
    {
      id: "incomplete",
      label: t("activities.overview.tiles.missingData"),
      value: summary === undefined ? null : String(summary.incomplete),
      tone: (summary?.incomplete ?? 0) > 0 ? "warning" : "neutral",
      ...(missing === undefined
        ? {}
        : {
            hint:
              missing.fuel === null
                ? t("activities.overview.tiles.missingKm", { km: missing.km })
                : t("activities.overview.tiles.missingFuelKm", { fuel: missing.fuel, km: missing.km }),
          }),
      // Fuel is a money fact: while Money is off it is not counted, and the tile says so.
      info: t("activities.overview.tiles.missingDataInfo", { fuelCounted: missing?.fuel === null ? "no" : "yes" }),
      link: { to: LIST, search: { completeness: "COMPLETE_WITH_EXCEPTIONS" } },
    },
  ];
}

/**
 * Km of legs recorded empty ÷ km of legs with a load recorded, this period
 * against the comparison window, in points. Km whose load nobody recorded are
 * left out and said; with no load recorded at all the share is not recorded.
 */
function emptyKmTile(usage: FleetUsageResponse | undefined, t: Translate, language: string | undefined): MetricTile {
  const period = usage === undefined ? undefined : windowLabel(usage.period, usage.range, language);
  const tile: MetricTile = {
    id: "empty-km",
    label: t("activities.overview.tiles.emptyKm"),
    value: null,
    info: t("activities.overview.tiles.emptyKmInfo", { period: period ?? "" }),
  };
  if (usage === undefined || usage.trips === null) return tile;
  const share = (load: NonNullable<FleetUsageResponse["trips"]>["period"]) => wholeShare(load.emptyKm, load.emptyKm + load.loadedKm);
  const current = share(usage.trips.period);
  const comparison = windowLabel(usage.comparison, usage.range, language, "short");
  const change = pointsChange(current, share(usage.trips.comparison));
  const changeText =
    change === null
      ? undefined
      : change.kind === "same"
        ? t("activities.overview.tiles.emptyKmSame", { period: comparison })
        : t("activities.overview.tiles.emptyKmChange", { arrow: change.arrow, points: change.points, period: comparison });
  const unknown = usage.trips.period.unknownLoadKm;
  const hint =
    unknown === 0
      ? changeText
      : changeText === undefined
        ? t("activities.overview.tiles.emptyKmUnknown", { km: unknown })
        : t("activities.overview.tiles.emptyKmChangeUnknown", { change: changeText, km: unknown });
  return {
    ...tile,
    value: current === null ? null : formatPercent(current, language),
    ...(hint === undefined ? {} : { hint }),
  };
}

/**
 * Which routes pay best? (dashboards.html#trips): revenue per km by route,
 * best first. A route whose revenue per km cannot be worked out is named as
 * not counted, never drawn as 0; the routes past the limit and the trips
 * with no route are said in words.
 */
function RoutesCard({
  usage,
  currency,
  trips,
}: {
  usage: FleetUsageResponse;
  currency: string;
  trips: NonNullable<FleetUsageResponse["trips"]>;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const period = windowLabel(usage.period, usage.range, language);
  const routeName = (route: FleetUsageRoute) => t("activities.overview.routes.route", { from: route.from, to: route.to });
  const list = (routes: readonly FleetUsageRoute[]) =>
    new Intl.ListFormat(language, { type: "conjunction" }).format(routes.map(routeName));
  const counted = trips.routes.filter((route) => route.revenuePerKmMinor !== null);
  const noKm = trips.routes.filter((route) => route.revenuePerKmMinor === null && route.km <= 0);
  const noRevenue = trips.routes.filter((route) => route.revenuePerKmMinor === null && route.km > 0);
  const notes = [
    noKm.length > 0 ? t("activities.overview.routes.noKm", { routes: list(noKm) }) : null,
    noRevenue.length > 0 ? t("activities.overview.routes.noRevenue", { routes: list(noRevenue) }) : null,
    trips.otherRoutes > 0 ? t("activities.overview.routes.otherRoutes", { count: trips.otherRoutes }) : null,
    trips.tripsWithoutRoute > 0 ? t("activities.overview.routes.withoutRoute", { count: trips.tripsWithoutRoute }) : null,
  ].filter((note): note is string => note !== null);

  return (
    <Card data-slot="revenue-per-km-by-route">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {t("activities.overview.routes.title")}
          <InfoPopover label={t("common.howCalculated")}>
            {t("activities.overview.routes.info", { period, currency: currencyUnit(currency) })}
          </InfoPopover>
        </CardTitle>
        {/* The window the ranking covers stays said: the period basis. */}
        <CardDescription data-slot="routes-period">{period}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {counted.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("activities.overview.routes.empty")}</p>
        ) : (
          <RankedBars
            rows={counted.map((route) => {
              const tripsText = t("dashboard.vehicles.tripsCount", { count: route.trips });
              const withoutKm = route.trips - route.tripsWithKm;
              return {
                key: route.key,
                label: routeName(route),
                value: route.revenuePerKmMinor ?? 0,
                detail:
                  withoutKm > 0
                    ? t("activities.overview.routes.detailWithoutKm", {
                        tally: tripsText,
                        without: t("dashboard.vehicles.tripsWithoutKm", { count: withoutKm }),
                      })
                    : tripsText,
              };
            })}
            format={(minor) => formatMoney(minor, { currency })}
            labelHeader={t("activities.overview.routes.labelHeader")}
            valueHeader={t("activities.overview.routes.valueHeader")}
            moreLabel={(count) => t("activities.overview.routes.more", { count })}
          />
        )}
        {/* What the ranking leaves out stays at rest: a route not counted is never a route at 0. */}
        {notes.length > 0 && (
          <p data-slot="routes-not-counted" className="text-xs text-muted-foreground">
            {notes.join(" ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Open trips, then closed trips missing a fact: one row per kind with its count,
 * its verb the next step, the list one tap away. The oldest open trip's date is
 * on the On the road tile.
 */
export function tripToDo(summary: ActivitySummary, t: Translate): ToDoItem[] {
  const items: ToDoItem[] = [];
  if (summary.open > 0) {
    items.push({
      key: "open",
      icon: <Route className="size-4" aria-hidden />,
      title: t("activities.overview.todo.open", { count: summary.open }),
      action: { label: t("activities.overview.todo.closeTrips"), to: LIST, search: { status: "OPEN" } },
    });
  }
  const fuel = summary.closedMissing.fuel;
  if (fuel !== null && fuel > 0) {
    items.push({
      key: "fuel",
      icon: <Fuel className="size-4 text-warning-foreground" aria-hidden />,
      title: t("activities.overview.todo.noFuel", { count: fuel }),
      action: { label: t("activities.overview.todo.complete"), to: LIST, search: { missing: "fuel" } },
    });
  }
  if (summary.closedMissing.km > 0) {
    items.push({
      key: "km",
      icon: <Gauge className="size-4 text-warning-foreground" aria-hidden />,
      title: t("activities.overview.todo.noKm", { count: summary.closedMissing.km }),
      action: { label: t("activities.overview.todo.complete"), to: LIST, search: { missing: "km" } },
    });
  }
  return items;
}
