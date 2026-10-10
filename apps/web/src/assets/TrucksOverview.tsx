import { Link } from "@tanstack/react-router";
import type { AssetOverview, AssetSummary, ComingUpResponse, FinanceOverviewResponse, FleetUsageResponse } from "@routiq/contracts";
import { FLEET_BOARD_DAYS, MONEY_OVERVIEW_READER_ROLES, type Role } from "@routiq/contracts";
import { CalendarClock, CalendarX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { MetricStrip, metricTiles, type MetricTile } from "@/components/metric-strip.js";
import { OverviewSummary } from "@/components/overview/overview-summary.js";
import { FleetBoard } from "@/components/overview/fleet-board.js";
import { ProfitBars } from "@/components/overview/profit-bars.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { StatusBadge } from "@/components/status-badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatPercent, localizedLabel, profitOrLoss } from "@/lib/format.js";
import { contributes } from "@/modules/manifest.js";
import {
  FLEET_DOCUMENT_WINDOW_DAYS,
  fleetDocumentLink,
  fleetDocumentRows,
  fleetDocumentsTruncated,
  type FleetDocumentRow,
} from "@/overview/fleet-documents.js";
import { useComingUp, useTodo } from "@/overview/useFleetAttention.js";
import { onTheRoadShare, PAGE_USAGE_RANGE, pointsChange, useFleetUsage } from "@/overview/useFleetUsage.js";
import { useMoneyOverview } from "@/overview/useMoneyOverview.js";
import { canReadFleetDocuments } from "./trucksTabs.js";
import { useAssetOverview } from "./useAssetOverview.js";
import { useAssetSummary } from "./useAssetSummary.js";

type Translate = ReturnType<typeof useTranslation>["t"];

/** Whole days from an instant to now; the server judged the tile, this only words its example. */
function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/**
 * role-config: profit by truck for the roles that read profit. The Money
 * Overview's read answers the cashier too, without any profit in it; the
 * chart then has nothing to draw and is left out.
 */
function readsMoneyOverview(role: Role | undefined, enabledModules: readonly string[] | undefined): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    (MONEY_OVERVIEW_READER_ROLES as readonly Role[]).includes(role)
  );
}

/**
 * Trucks › Overview (#665, dashboards.html#trucks): can the fleet work, and
 * what does each truck earn? Every tile opens a tab already filtered.
 */
export function TrucksOverview() {
  const { t, i18n } = useTranslation();
  const me = useMeContext();
  const overviewQuery = useAssetOverview();
  // Today's Attention tile moved here from the list (#665).
  const summaryQuery = useAssetSummary();
  const documentsShown = canReadFleetDocuments(me?.role, me?.enabledModules);
  const comingUpQuery = useComingUp(FLEET_DOCUMENT_WINDOW_DAYS, documentsShown);
  const todoQuery = useTodo(documentsShown);
  const moneyShown = readsMoneyOverview(me?.role, me?.enabledModules);
  const moneyQuery = useMoneyOverview("THIS_MONTH", moneyShown);
  // Km and daily status are every vehicle reader's (#668); the money in it is left to the server.
  const usageQuery = useFleetUsage(PAGE_USAGE_RANGE);
  const groundingCounted = contributes("fields", "assets.attentionGrounding", me?.enabledModules);
  const vehicles = moneyQuery.data?.vehicles ?? null;
  const overview = overviewQuery.data;
  const documentRows = fleetDocumentRows(todoQuery.data, comingUpQuery.data);

  const tiles = metricTiles(
    overviewTiles({
      overview: overviewQuery.data,
      summary: summaryQuery.data,
      comingUp: documentsShown ? comingUpQuery.data : null,
      usage: usageQuery.data,
      groundingCounted,
      t,
      language: i18n.resolvedLanguage,
    }),
  );

  return (
    <div data-slot="trucks-overview" className="flex flex-col gap-5">
      {overviewQuery.isError && (
        <ErrorState
          message={t("assets.overview.loadFailed")}
          retryLabel={t("assets.retry")}
          onRetry={() => void overviewQuery.refetch()}
        />
      )}
      <OverviewSummary
        page="trucks"
        notice={overview?.notice}
        sentence={
          overview === undefined
            ? undefined
            : t("assets.overview.summary.sentence", { canDrive: overview.canDrive, total: overview.total })
        }
        details={overview === undefined ? undefined : truckSummaryDetails(overview, t, i18n.resolvedLanguage)}
        badge={
          overview?.grounded == null ? undefined : (
            <StatusBadge tone={overview.grounded.count > 0 ? "warning" : "success"} icon={null}>
              {t("assets.overview.summary.badge", { count: overview.grounded.count })}
            </StatusBadge>
          )
        }
        counted={
          overview === undefined ? null : (
            <span data-slot="trucks-counted">
              {t(groundingCounted ? "assets.overview.tiles.canDriveInfo" : "assets.overview.tiles.canDriveInfoNoGrounding")}
            </span>
          )
        }
      >
        {tiles !== undefined && (
          <MetricStrip
            tiles={tiles}
            isPending={overviewQuery.isPending || summaryQuery.isPending}
            isError={overviewQuery.isError || summaryQuery.isError}
          />
        )}
      </OverviewSummary>
      {usageQuery.data !== undefined && <KmCoverage usage={usageQuery.data} />}

      <FleetBoardCard usage={usageQuery.data} isPending={usageQuery.isPending} isError={usageQuery.isError} onRetry={() => void usageQuery.refetch()} />

      {(moneyShown || documentsShown) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {documentsShown && (
            // On a phone people act first: what is due comes before the chart.
            <Card className="order-first lg:order-last">
              <CardHeader>
                <CardTitle>{t("assets.overview.due.title")}</CardTitle>
                <CardDescription>{t("assets.overview.due.window", { days: FLEET_DOCUMENT_WINDOW_DAYS })}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {comingUpQuery.isPending || todoQuery.isPending ? (
                  <Skeleton className="h-24 w-full" />
                ) : comingUpQuery.isError || todoQuery.isError ? (
                  <p className="text-sm text-muted-foreground">{t("assets.overview.due.loadFailed")}</p>
                ) : (
                  <ToDoList
                    items={documentRows.map((row) => documentItem(row, t, i18n.resolvedLanguage))}
                    empty={t("assets.overview.due.empty", { days: FLEET_DOCUMENT_WINDOW_DAYS })}
                  />
                )}
                <DueFootnote
                  comingUp={comingUpQuery.data}
                  truncated={fleetDocumentsTruncated(todoQuery.data, comingUpQuery.data)}
                  rows={documentRows.length}
                />
              </CardContent>
            </Card>
          )}
          {moneyShown && (moneyQuery.isPending || vehicles !== null) && (
            <ProfitByTruckCard overview={moneyQuery.data} isPending={moneyQuery.isPending} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The vehicle grounded longest, when one is: the Trucks summary's second
 * sentence, left out when the notice already names that grounding as a change.
 */
export function truckSummaryDetails(overview: AssetOverview, t: Translate, language: string | undefined): string[] {
  const first = overview.grounded?.first;
  if (first == null) return [];
  // A read from before #667 carries no notice.
  const changes: AssetOverview["notice"]["changes"] = (overview as Partial<AssetOverview>).notice?.changes ?? [];
  if (changes.some((change) => change.kind === "VEHICLE_GROUNDED" && change.assetId === first.assetId)) return [];
  return [t("assets.overview.summary.longest", { code: first.assetCode, date: formatDate(first.since, language) })];
}

export function overviewTiles({
  overview,
  summary,
  comingUp,
  usage,
  groundingCounted,
  t,
  language,
}: {
  overview: AssetOverview | undefined;
  summary: AssetSummary | undefined;
  /** Null when this viewer gets no Documents tab. */
  comingUp: ComingUpResponse | undefined | null;
  /** The km and daily-status read; its board days give "on the road". */
  usage?: FleetUsageResponse | undefined;
  groundingCounted: boolean;
  t: Translate;
  language: string | undefined;
}): MetricTile[] {
  const list = (availability: "CAN_DRIVE" | "GROUNDED" | "IDLE") => ({
    to: "/assets/list",
    search: { availability },
  });
  const tiles: MetricTile[] = [
    {
      id: "can-drive",
      label: t("assets.overview.tiles.canDrive"),
      value: overview === undefined ? null : String(overview.canDrive),
      ...(overview === undefined ? {} : { hint: t("assets.overview.tiles.canDriveOf", { total: overview.total }) }),
      info: t(groundingCounted ? "assets.overview.tiles.canDriveInfo" : "assets.overview.tiles.canDriveInfoNoGrounding"),
      link: list("CAN_DRIVE"),
    },
  ];
  // A module that is off counts nothing: its tile goes, it never reads zero.
  if (overview === undefined || overview.grounded !== null) {
    const grounded = overview?.grounded ?? null;
    tiles.push({
      id: "grounded",
      label: t("assets.overview.tiles.grounded"),
      value: grounded === null ? null : String(grounded.count),
      tone: (grounded?.count ?? 0) > 0 ? "warning" : "neutral",
      ...(grounded === null
        ? {}
        : {
            hint:
              grounded.first === null
                ? t("assets.overview.tiles.groundedNone")
                : t("assets.overview.tiles.groundedFirst", {
                    code: grounded.first.assetCode,
                    days: daysSince(grounded.first.since),
                  }),
          }),
      link: list("GROUNDED"),
    });
  }
  // Trips off: no day can be on the road, so the tile goes rather than reading 0 %.
  if (usage === undefined || usage.trips !== null) tiles.push(onTheRoadTile(usage, t, language));
  if (comingUp !== null) {
    const due = comingUp?.rows.filter((row) => row.code === "DOCUMENT_DUE") ?? [];
    const first = due[0];
    tiles.push({
      id: "documents-due",
      label: t("assets.overview.tiles.documentsDue", { days: FLEET_DOCUMENT_WINDOW_DAYS }),
      value: comingUp === undefined ? null : String(due.length),
      ...(comingUp === undefined
        ? {}
        : {
            hint:
              first === undefined
                ? t("assets.overview.tiles.documentsDueNone")
                : t("assets.overview.tiles.documentsDueFirst", {
                    code: first.asset?.assetCode ?? "",
                    date: formatDate(first.dueDate, language),
                  }),
          }),
      link: { to: "/assets/documents", search: { expiry: "DUE_30" } },
    });
  }
  if (overview === undefined || overview.idle !== null) {
    const idle = overview?.idle ?? null;
    tiles.push({
      id: "idle",
      label: t("assets.overview.tiles.idle", { days: idle?.days ?? 5 }),
      value: idle === null ? null : String(idle.count),
      ...(idle === null
        ? {}
        : {
            hint:
              idle.first === null
                ? t("assets.overview.tiles.idleNone")
                : idle.first.lastTripAt === null
                  ? t("assets.overview.tiles.idleNever", { code: idle.first.assetCode })
                  : t("assets.overview.tiles.idleFirst", {
                      code: idle.first.assetCode,
                      days: daysSince(idle.first.lastTripAt),
                    }),
          }),
      link: list("IDLE"),
    });
  }
  // Five tiles at most (dashboards.html#trucks): Attention keeps its place only while there is room.
  if (tiles.length < 5) {
    tiles.push({
      id: "attention",
      label: t("assets.metrics.attention"),
      value: summary === undefined ? null : String(summary.attention),
      tone: (summary?.attention ?? 0) > 0 ? "warning" : "neutral",
      hint: t(groundingCounted ? "assets.metrics.attentionHint" : "assets.metrics.attentionHintNoGrounding"),
      link: { to: "/assets/list", search: { status: "ATTENTION" } },
    });
  }
  return tiles;
}

/**
 * Days on a trip ÷ days recorded over the board's 30 days, against the 30
 * before, in points. Days nobody could record are left out of both and said
 * in the hint; with none recorded the share is not recorded, never 0 %.
 */
function onTheRoadTile(usage: FleetUsageResponse | undefined, t: Translate, language: string | undefined): MetricTile {
  const days = FLEET_BOARD_DAYS;
  const tile: MetricTile = {
    id: "on-the-road",
    label: t("assets.overview.tiles.onTheRoad", { days }),
    value: null,
    info: t("assets.overview.tiles.onTheRoadInfo", { days }),
  };
  if (usage === undefined) return tile;
  const { last, previous } = usage.onTheRoad;
  const share = onTheRoadShare(last);
  const change = pointsChange(share, onTheRoadShare(previous));
  const changeText =
    change === null
      ? undefined
      : change.kind === "same"
        ? t("assets.overview.tiles.onTheRoadSame", { days })
        : t("assets.overview.tiles.onTheRoadChange", { arrow: change.arrow, points: change.points, days });
  const missing = last.notRecordedDays;
  const hint =
    missing === 0
      ? changeText
      : changeText === undefined
        ? t("assets.overview.tiles.onTheRoadNotRecorded", { count: missing })
        : t("assets.overview.tiles.onTheRoadChangeNotRecorded", { change: changeText, count: missing });
  return {
    ...tile,
    value: share === null ? null : formatPercent(share, language),
    ...(hint === undefined ? {} : { hint }),
  };
}

/** Whose km are known this month, and why some are not: every per-km figure leaves the unknown out. */
function KmCoverage({ usage }: { usage: FleetUsageResponse }) {
  const { t } = useTranslation();
  if (usage.km === null) return null;
  const { vehicles, knownVehicles } = usage.km.period;
  if (vehicles === 0) return null;
  const tripsWithoutKm = usage.vehicles.reduce((sum, vehicle) => sum + (vehicle.period?.tripsWithoutKm ?? 0), 0);
  return (
    <p data-slot="km-coverage" className="-mt-2 text-xs text-muted-foreground">
      {knownVehicles === vehicles
        ? t("assets.overview.km.all", { count: vehicles })
        : t("assets.overview.km.some", { known: knownVehicles, total: vehicles, missing: tripsWithoutKm })}
    </p>
  );
}

/** The basis line names what the statuses come from, and what an off module leaves unrecorded. */
function boardBasis(usage: FleetUsageResponse): string {
  const trips = usage.trips !== null;
  const maintenance = usage.offRoadByMonth !== null;
  if (trips && maintenance) return "assets.overview.board.basis.all";
  if (trips) return "assets.overview.board.basis.noMaintenance";
  if (maintenance) return "assets.overview.board.basis.noTrips";
  return "assets.overview.board.basis.none";
}

function FleetBoardCard({
  usage,
  isPending,
  isError,
  onRetry,
}: {
  usage: FleetUsageResponse | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card data-slot="fleet-board-card">
      <CardHeader>
        <CardTitle>{t("assets.overview.board.title")}</CardTitle>
        <CardDescription>{t("assets.overview.board.question", { days: FLEET_BOARD_DAYS })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isError ? (
          <ErrorState message={t("assets.overview.board.loadFailed")} retryLabel={t("assets.retry")} onRetry={onRetry} />
        ) : isPending || usage === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : usage.vehicles.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("assets.overview.board.empty")}</p>
        ) : (
          <FleetBoard
            days={usage.boardDays}
            rows={usage.vehicles.map((vehicle) => ({
              key: vehicle.assetId,
              label: vehicle.assetCode,
              to: `/assets/${vehicle.assetId}`,
              days: vehicle.days,
            }))}
          />
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
          {usage !== undefined && <span>{t(boardBasis(usage))}</span>}
          <Link to="/assets/list" className="ms-auto text-sm font-medium text-foreground underline-offset-4 hover:underline">
            {t("assets.overview.board.open")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function documentItem(row: FleetDocumentRow, t: Translate, language: string | undefined): ToDoItem {
  const type = localizedLabel({ labelFr: row.typeLabelFr, labelEn: row.typeLabelEn }, language);
  const date = formatDate(row.expiresAt, language);
  const link = fleetDocumentLink(row);
  return {
    key: row.key,
    icon:
      row.state === "EXPIRED" ? (
        <CalendarX className="size-4 text-destructive" aria-hidden />
      ) : (
        <CalendarClock className="size-4" aria-hidden />
      ),
    title: t("assets.overview.due.rowTitle", { code: row.asset?.assetCode ?? "", type }),
    detail:
      row.state === "EXPIRED"
        ? t("assets.overview.due.expired", { date, days: Math.abs(row.daysLeft ?? 0) })
        : t("assets.overview.due.dueIn", { date, days: row.daysLeft ?? 0 }),
    action: {
      label: t("documents.renew"),
      to: link?.to ?? "/assets/documents",
      ...(link?.search === undefined ? {} : { search: link.search }),
    },
  };
}

/** What the list could not count, said in words, and the way to every row. */
function DueFootnote({
  comingUp,
  truncated,
  rows,
}: {
  comingUp: ComingUpResponse | undefined;
  truncated: boolean;
  rows: number;
}) {
  const { t } = useTranslation();
  const serviceNotCounted = comingUp?.notCounted.includes("SERVICE_DUE_BY_KM") ?? false;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {serviceNotCounted && <p data-slot="service-not-counted">{t("assets.overview.due.serviceNotCounted")}</p>}
      {truncated && <p>{t("assets.overview.due.truncated")}</p>}
      {rows > 0 && (
        <Link to="/assets/documents" className="self-end text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {t("assets.overview.due.openAll")}
        </Link>
      )}
    </div>
  );
}

function ProfitByTruckCard({ overview, isPending }: { overview: FinanceOverviewResponse | undefined; isPending: boolean }) {
  const { t, i18n } = useTranslation();
  const vehicles = overview?.vehicles ?? [];
  const currency = overview?.currency ?? "XAF";
  const period =
    overview === undefined
      ? undefined
      : new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "long", day: "numeric", timeZone: "UTC" }).formatRange(
          new Date(`${overview.period.from}T00:00:00Z`),
          new Date(`${overview.period.to}T00:00:00Z`),
        );
  return (
    <Card data-slot="profit-by-truck">
      <CardHeader>
        <CardTitle>{t("assets.overview.profit.title")}</CardTitle>
        <CardDescription>
          {period === undefined ? t("assets.overview.profit.question") : t("assets.overview.profit.questionPeriod", { period })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : vehicles.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("assets.overview.profit.empty")}</p>
        ) : (
          <ProfitBars
            rows={vehicles.map((vehicle) => ({
              key: vehicle.assetId,
              label: vehicle.assetCode,
              value: vehicle.profitMinor,
              to: `/assets/${vehicle.assetId}`,
              ...(vehicle.tripsClosed === null
                ? {}
                : {
                    detail:
                      vehicle.distanceKm === null
                        ? t("assets.overview.profit.trips", { count: vehicle.tripsClosed })
                        : t("assets.overview.profit.tripsKm", { count: vehicle.tripsClosed, km: vehicle.distanceKm }),
                  }),
            }))}
            format={(value) => profitOrLoss(value, { currency }).text}
            moreLabel={(count) => t("assets.overview.profit.more", { count })}
          />
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("assets.overview.profit.basis")}</span>
          <Link to="/finance" className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
            {t("assets.overview.profit.openMoney")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
