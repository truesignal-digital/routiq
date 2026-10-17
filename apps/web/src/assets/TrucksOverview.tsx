import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { AssetOverview, AssetSummary, ComingUpResponse, FinanceOverviewResponse, FleetUsageResponse } from "@routiq/contracts";
import { FLEET_BOARD_DAYS, MONEY_OVERVIEW_READER_ROLES, type Role } from "@routiq/contracts";
import { CalendarClock, CalendarX, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { MetricStrip, metricTiles, type MetricTile } from "@/components/metric-strip.js";
import { FleetBoard } from "@/components/overview/fleet-board.js";
import { OverviewSummary } from "@/components/overview/overview-summary.js";
import { ProfitBars } from "@/components/overview/profit-bars.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { InfoPopover } from "@/components/info-popover.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateRange, formatPercent, localizedLabel, profitOrLoss } from "@/lib/format.js";
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

/** Papers to renew on the Overview: three rows, then "See all" (the Documents tab lists every one). */
const DUE_LIMIT = 3;

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
        counted={overview === undefined ? null : <TrucksCounted groundingCounted={groundingCounted} />}
      >
        {tiles !== undefined && (
          <MetricStrip
            tiles={tiles}
            isPending={overviewQuery.isPending || summaryQuery.isPending}
            isError={overviewQuery.isError || summaryQuery.isError}
          />
        )}
        {usageQuery.data !== undefined && <KmCoverage usage={usageQuery.data} />}
      </OverviewSummary>

      {(moneyShown || documentsShown) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {documentsShown && (
            // What needs someone comes before the chart.
            <Card data-slot="trucks-due">
              <CardHeader>
                <CardTitle>{t("assets.overview.due.titleWithin", { days: FLEET_DOCUMENT_WINDOW_DAYS })}</CardTitle>
                {documentRows.length > DUE_LIMIT && (
                  <CardAction>
                    <CardLink to="/assets/documents">{t("assets.overview.due.seeAll", { count: documentRows.length })}</CardLink>
                  </CardAction>
                )}
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
                    limit={DUE_LIMIT}
                  />
                )}
                <DueFootnote
                  comingUp={comingUpQuery.data}
                  truncated={fleetDocumentsTruncated(todoQuery.data, comingUpQuery.data)}
                />
              </CardContent>
            </Card>
          )}
          {moneyShown && (moneyQuery.isPending || vehicles !== null) && (
            <ProfitByTruckCard overview={moneyQuery.data} isPending={moneyQuery.isPending} />
          )}
        </div>
      )}

      <FleetBoardCard usage={usageQuery.data} isPending={usageQuery.isPending} isError={usageQuery.isError} onRetry={() => void usageQuery.refetch()} />
    </div>
  );
}

/**
 * What "can drive" counts. Maintenance off, it cannot know about groundings:
 * a warning, under the tiles when the summary is closed, inside it when open.
 */
function TrucksCounted({ groundingCounted }: { groundingCounted: boolean }) {
  const { t } = useTranslation();
  if (groundingCounted) return <span data-slot="trucks-counted">{t("assets.overview.tiles.canDriveInfo")}</span>;
  return (
    <span data-slot="trucks-counted" className="flex items-center gap-1.5 text-warning-foreground">
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      {t("assets.overview.tiles.canDriveInfoNoGrounding")}
    </span>
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

/**
 * Whose km are unknown this month: every per-km figure leaves them out, so a
 * gap stays said at rest. When every km is known there is nothing to say.
 */
function KmCoverage({ usage }: { usage: FleetUsageResponse }) {
  const { t } = useTranslation();
  if (usage.km === null) return null;
  const { vehicles, knownVehicles } = usage.km.period;
  if (vehicles === 0 || knownVehicles === vehicles) return null;
  const tripsWithoutKm = usage.vehicles.reduce((sum, vehicle) => sum + (vehicle.period?.tripsWithoutKm ?? 0), 0);
  return (
    <p data-slot="km-coverage" className="-mt-2 flex items-center gap-1.5 text-xs text-warning-foreground">
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      {t("assets.overview.km.some", { known: knownVehicles, total: vehicles, missing: tripsWithoutKm })}
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
        <CardTitle className="flex items-center gap-1.5">
          {t("assets.overview.board.title")}
          {/* With every module on, where the statuses come from is a definition, one tap away. */}
          {usage !== undefined && boardBasis(usage) === "assets.overview.board.basis.all" && (
            <InfoPopover label={t("common.howCalculated")}>{t(boardBasis(usage))}</InfoPopover>
          )}
        </CardTitle>
        {/* The window the board covers stays said: the period basis. */}
        <CardDescription>{t("assets.overview.board.window", { days: FLEET_BOARD_DAYS })}</CardDescription>
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
        {/* A module that is off leaves days unrecorded: that stays said at rest. */}
        {usage !== undefined && boardBasis(usage) !== "assets.overview.board.basis.all" && (
          <p data-slot="board-basis" className="text-xs text-muted-foreground">
            {t(boardBasis(usage))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function documentItem(row: FleetDocumentRow, t: Translate, language: string | undefined): ToDoItem {
  const type = localizedLabel({ labelFr: row.typeLabelFr, labelEn: row.typeLabelEn }, language);
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
        ? t("assets.overview.due.expired", { days: Math.abs(row.daysLeft ?? 0) })
        : t("assets.overview.due.dueIn", { days: row.daysLeft ?? 0 }),
    action: {
      label: t("documents.renew"),
      to: link?.to ?? "/assets/documents",
      ...(link?.search === undefined ? {} : { search: link.search }),
    },
  };
}

/**
 * What the list could not count. A gap is a warning at rest, its reason one
 * tap away, so missing services never pass for "nothing due".
 */
function DueFootnote({ comingUp, truncated }: { comingUp: ComingUpResponse | undefined; truncated: boolean }) {
  const { t } = useTranslation();
  const serviceNotCounted = comingUp?.notCounted.includes("SERVICE_DUE_BY_KM") ?? false;
  if (!serviceNotCounted && !truncated) return null;
  return (
    <div className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
      {serviceNotCounted && (
        <span data-slot="service-not-counted">
          <InfoPopover
            label={t("assets.overview.due.serviceNotCountedShort")}
            trigger="text"
            className="text-warning-foreground"
            icon={<TriangleAlert className="size-4" aria-hidden />}
          >
            {t("assets.overview.due.serviceNotCounted")}
          </InfoPopover>
        </span>
      )}
      {truncated && <p>{t("assets.overview.due.truncated")}</p>}
    </div>
  );
}

/** A card header's link to the tab or page behind it; a 44 px target on a phone. */
function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 items-center text-sm font-medium whitespace-nowrap underline-offset-4 hover:underline desktop:min-h-6"
    >
      {children}
    </Link>
  );
}

function ProfitByTruckCard({ overview, isPending }: { overview: FinanceOverviewResponse | undefined; isPending: boolean }) {
  const { t, i18n } = useTranslation();
  const vehicles = overview?.vehicles ?? [];
  const currency = overview?.currency ?? "XAF";
  const period =
    overview === undefined
      ? undefined
      : formatDateRange(overview.period.from, overview.period.to, i18n.resolvedLanguage, { unit: "days" });
  return (
    <Card data-slot="profit-by-truck">
      <CardHeader>
        <CardTitle>{t("assets.overview.profit.title")}</CardTitle>
        {/* The month the figures cover and what the profit includes stay said at rest. */}
        {period !== undefined && (
          <CardDescription data-slot="profit-by-truck-period">{t("assets.overview.profit.periodBasis", { period })}</CardDescription>
        )}
        <CardAction>
          <CardLink to="/finance">{t("assets.overview.profit.openMoney")}</CardLink>
        </CardAction>
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
      </CardContent>
    </Card>
  );
}
