import { Link } from "@tanstack/react-router";
import type { ActivitySummary, FleetUsageResponse, FleetUsageRoute } from "@routiq/contracts";
import { Fuel, Gauge, Route } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MetricStrip, metricTiles, type MetricTile } from "@/components/metric-strip.js";
import { RankedBars } from "@/components/overview/ranked-bars.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { WeekColumns } from "@/components/overview/week-columns.js";
import { ErrorState } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatMoney, formatPercent } from "@/lib/format.js";
import { PAGE_USAGE_RANGE, pointsChange, useFleetUsage, wholeShare } from "@/overview/useFleetUsage.js";
import { windowLabel } from "@/overview/window-label.js";
import { useActivitySummary } from "./useActivities.js";

type Translate = ReturnType<typeof useTranslation>["t"];

const LIST = "/activities/list";

function shortDay(iso: string, language: string | undefined): string {
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/**
 * Trips › Overview (#665, dashboards.html#trips): how much work was done and
 * what is left to close. Every tile and every column opens the Trips tab
 * already filtered, so a number and its list always count the same trips.
 */
export function TripsOverview() {
  const { t, i18n } = useTranslation();
  const summaryQuery = useActivitySummary();
  const summary = summaryQuery.data;
  const usageQuery = useFleetUsage(PAGE_USAGE_RANGE);
  const usage = usageQuery.data;
  const language = i18n.resolvedLanguage;
  const tiles = metricTiles(tripTiles(summary, t, language, usage));

  return (
    <div data-slot="trips-overview" className="flex flex-col gap-5">
      {summaryQuery.isError && (
        <ErrorState
          message={t("activities.loadFailed")}
          retryLabel={t("activities.retry")}
          onRetry={() => void summaryQuery.refetch()}
        />
      )}
      {tiles !== undefined && (
        <MetricStrip tiles={tiles} isPending={summaryQuery.isPending} isError={summaryQuery.isError} />
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card data-slot="trips-per-week">
          <CardHeader>
            <CardTitle>{t("activities.overview.weeks.title")}</CardTitle>
            <CardDescription>{t("activities.overview.weeks.question", { count: summary?.weeks.length ?? 12 })}</CardDescription>
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
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("activities.overview.weeks.partial")}</span>
              <Link to={LIST} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
                {t("activities.overview.openList")}
              </Link>
            </div>
          </CardContent>
        </Card>
        {/* On a phone people act first: To do comes before the chart. */}
        <Card className="order-first lg:order-none">
          <CardHeader>
            <CardTitle>{t("activities.overview.todo.title")}</CardTitle>
            <CardDescription>{t("activities.overview.todo.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {summary === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ToDoList items={tripToDo(summary, t, language)} empty={t("activities.overview.todo.empty")} />
            )}
          </CardContent>
        </Card>
        {/* Revenue per km is vehicle money: only for the roles the server sends it to. */}
        {usage?.money != null && usage.trips !== null && <RoutesCard usage={usage} currency={usage.money.currency} trips={usage.trips} />}
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
    hint: t("activities.metrics.weekKmHint"),
  };
  return [
    {
      id: "week-closed",
      label: t("activities.overview.tiles.weekClosed"),
      value: summary === undefined ? null : String(summary.weekClosed),
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
      info: t("activities.overview.tiles.missingDataInfo"),
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
        <CardTitle>{t("activities.overview.routes.title")}</CardTitle>
        <CardDescription>
          {t("activities.overview.routes.question", { period: windowLabel(usage.period, usage.range, language), currency })}
        </CardDescription>
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
        {notes.length > 0 && (
          <p data-slot="routes-not-counted" className="text-xs text-muted-foreground">
            {notes.join(" ")}
          </p>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("activities.overview.routes.basis")}</span>
          <Link to={LIST} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
            {t("activities.overview.openList")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** Open trips, then closed trips missing a fact; at most one row each, the list one tap away. */
export function tripToDo(summary: ActivitySummary, t: Translate, language: string | undefined): ToDoItem[] {
  const items: ToDoItem[] = [];
  if (summary.open > 0) {
    const oldest = summary.oldestOpen;
    items.push({
      key: "open",
      icon: <Route className="size-4" aria-hidden />,
      title: t("activities.overview.todo.open", { count: summary.open }),
      ...(oldest === null
        ? {}
        : {
            detail:
              oldest.assetCode === null
                ? t("activities.overview.todo.oldest", {
                    number: oldest.activityNumber,
                    date: formatDate(oldest.startedAt, language),
                  })
                : t("activities.overview.todo.oldestWithTruck", {
                    number: oldest.activityNumber,
                    code: oldest.assetCode,
                    date: formatDate(oldest.startedAt, language),
                  }),
          }),
      action: { label: t("activities.overview.todo.openList"), to: LIST, search: { status: "OPEN" } },
    });
  }
  const fuel = summary.closedMissing.fuel;
  if (fuel !== null && fuel > 0) {
    items.push({
      key: "fuel",
      icon: <Fuel className="size-4 text-warning-foreground" aria-hidden />,
      title: t("activities.overview.todo.noFuel", { count: fuel }),
      detail: t("activities.overview.todo.noFuelDetail"),
      action: { label: t("activities.overview.todo.openList"), to: LIST, search: { missing: "fuel" } },
    });
  }
  if (summary.closedMissing.km > 0) {
    items.push({
      key: "km",
      icon: <Gauge className="size-4 text-warning-foreground" aria-hidden />,
      title: t("activities.overview.todo.noKm", { count: summary.closedMissing.km }),
      detail: t("activities.overview.todo.noKmDetail"),
      action: { label: t("activities.overview.todo.openList"), to: LIST, search: { missing: "km" } },
    });
  }
  return items;
}
