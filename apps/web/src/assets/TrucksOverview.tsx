import { Link } from "@tanstack/react-router";
import type { AssetOverview, AssetSummary, ComingUpResponse, FinanceOverviewResponse } from "@routiq/contracts";
import { MONEY_OVERVIEW_READER_ROLES, type Role } from "@routiq/contracts";
import { CalendarClock, CalendarX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { MetricStrip, metricTiles, type MetricTile } from "@/components/metric-strip.js";
import { ProfitBars } from "@/components/overview/profit-bars.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, localizedLabel, profitOrLoss } from "@/lib/format.js";
import { contributes } from "@/modules/manifest.js";
import {
  FLEET_DOCUMENT_WINDOW_DAYS,
  fleetDocumentLink,
  fleetDocumentRows,
  fleetDocumentsTruncated,
  type FleetDocumentRow,
} from "@/overview/fleet-documents.js";
import { useComingUp, useTodo } from "@/overview/useFleetAttention.js";
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
  const groundingCounted = contributes("fields", "assets.attentionGrounding", me?.enabledModules);
  const vehicles = moneyQuery.data?.vehicles ?? null;
  const documentRows = fleetDocumentRows(todoQuery.data, comingUpQuery.data);

  const tiles = metricTiles(
    overviewTiles({
      overview: overviewQuery.data,
      summary: summaryQuery.data,
      comingUp: documentsShown ? comingUpQuery.data : null,
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
      {tiles !== undefined && (
        <MetricStrip
          tiles={tiles}
          isPending={overviewQuery.isPending || summaryQuery.isPending}
          isError={overviewQuery.isError || summaryQuery.isError}
        />
      )}

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

export function overviewTiles({
  overview,
  summary,
  comingUp,
  groundingCounted,
  t,
  language,
}: {
  overview: AssetOverview | undefined;
  summary: AssetSummary | undefined;
  /** Null when this viewer gets no Documents tab. */
  comingUp: ComingUpResponse | undefined | null;
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
  tiles.push({
    id: "attention",
    label: t("assets.metrics.attention"),
    value: summary === undefined ? null : String(summary.attention),
    tone: (summary?.attention ?? 0) > 0 ? "warning" : "neutral",
    hint: t(groundingCounted ? "assets.metrics.attentionHint" : "assets.metrics.attentionHintNoGrounding"),
    link: { to: "/assets/list", search: { status: "ATTENTION" } },
  });
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
  return tiles;
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
          {period === undefined ? t("assets.overview.profit.question") : t("assets.overview.profit.questionPeriod", { period, currency })}
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
