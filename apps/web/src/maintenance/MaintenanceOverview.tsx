import { Link } from "@tanstack/react-router";
import type { FleetUsageResponse, IssueListItem, MaintenanceSummary } from "@routiq/contracts";
import { OPEN_WORK_ORDER_STATUSES } from "@routiq/contracts";
import { CircleAlert, Clock, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MetricStrip, metricTiles, moneyMetric, type MetricTile } from "@/components/metric-strip.js";
import { MonthColumns } from "@/components/overview/month-columns.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatDate, formatRelativeTime } from "@/lib/format.js";
import { PAGE_USAGE_RANGE, useFleetUsage } from "@/overview/useFleetUsage.js";
import { useIssues, useMaintenanceSummary } from "./useMaintenance.js";

type Translate = ReturnType<typeof useTranslation>["t"];

const LIVE_WORK_ORDER: readonly string[] = OPEN_WORK_ORDER_STATUSES;

/**
 * Maintenance › Overview (#665, dashboards.html#maintenance): what is off the
 * road, for how long and at what cost. Repair cost comes from work orders
 * only, and only for the roles allowed to read it; nothing here is revenue or
 * profit, so a technician sees all of it.
 */
export function MaintenanceOverview() {
  const { t, i18n } = useTranslation();
  const summaryQuery = useMaintenanceSummary();
  const issuesQuery = useIssues({ status: "OPEN" });
  const usageQuery = useFleetUsage(PAGE_USAGE_RANGE);
  const summary = summaryQuery.data;
  const language = i18n.resolvedLanguage;
  const tiles = metricTiles(maintenanceTiles(summary, t, language));
  const openIssues = issuesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div data-slot="maintenance-overview" className="flex flex-col gap-5">
      {summaryQuery.isError && (
        <ErrorState
          message={t("maintenance.overview.loadFailed")}
          retryLabel={t("maintenance.retry")}
          onRetry={() => void summaryQuery.refetch()}
        />
      )}
      {tiles !== undefined && (
        <MetricStrip tiles={tiles} isPending={summaryQuery.isPending} isError={summaryQuery.isError} />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Maintenance off: no day is counted off the road, so the chart goes. */}
        {(usageQuery.isPending || usageQuery.isError || usageQuery.data?.offRoadByMonth != null) && (
          <OffRoadCard usage={usageQuery.data} isError={usageQuery.isError} onRetry={() => void usageQuery.refetch()} />
        )}
      {/* On a phone people act first: To do comes before the chart. */}
      <Card className="order-first lg:order-none">
        <CardHeader>
          <CardTitle>{t("maintenance.overview.todo.title")}</CardTitle>
          <CardDescription>{t("maintenance.overview.todo.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {summary === undefined || issuesQuery.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ToDoList
              items={maintenanceToDo(summary, openIssues, t, language)}
              empty={t("maintenance.overview.todo.empty")}
            />
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function shortMonth(periodCode: string, language: string | undefined, month: "short" | "long"): string {
  return new Intl.DateTimeFormat(language, { month, timeZone: "UTC" }).format(new Date(`${periodCode}-15T00:00:00Z`));
}

/**
 * Are repairs keeping vehicles off the road longer? (dashboards.html#maintenance):
 * vehicle-days in the workshop or grounded, one column per month, the
 * current month partial and labelled so. No money in it: a technician sees it.
 */
function OffRoadCard({
  usage,
  isError,
  onRetry,
}: {
  usage: FleetUsageResponse | undefined;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const months = usage?.offRoadByMonth ?? null;
  const partial = months?.find((month) => month.partial);
  return (
    <Card data-slot="days-off-road">
      <CardHeader>
        <CardTitle>{t("maintenance.overview.offRoad.title")}</CardTitle>
        <CardDescription>{t("maintenance.overview.offRoad.question")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isError ? (
          <ErrorState message={t("maintenance.overview.offRoad.loadFailed")} retryLabel={t("maintenance.retry")} onRetry={onRetry} />
        ) : months === null ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <MonthColumns
            monthHeader={t("maintenance.overview.offRoad.monthHeader")}
            valueHeader={t("maintenance.overview.offRoad.valueHeader")}
            columns={months.map((month) => {
              const name = shortMonth(month.periodCode, language, "long");
              const values = { month: name, days: month.days };
              return {
                key: month.periodCode,
                label: shortMonth(month.periodCode, language, "short"),
                month: month.partial ? t("maintenance.overview.offRoad.monthPartial", { month: name }) : name,
                value: month.days,
                valueText: formatCount(month.days, language),
                description: t(month.partial ? "maintenance.overview.offRoad.columnPartial" : "maintenance.overview.offRoad.column", values),
                partial: month.partial,
              };
            })}
          />
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
          {partial !== undefined && usage !== undefined && (
            <span>
              {t("maintenance.overview.offRoad.partial", {
                month: shortMonth(partial.periodCode, language, "long"),
                days: Number(usage.businessDate.slice(8, 10)),
              })}
            </span>
          )}
          <Link to="/maintenance/work-orders" className="ms-auto text-sm font-medium text-foreground underline-offset-4 hover:underline">
            {t("maintenance.overview.offRoad.open")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function maintenanceTiles(
  summary: MaintenanceSummary | undefined,
  t: Translate,
  language: string | undefined,
): MetricTile[] {
  const tiles: MetricTile[] = [
    {
      id: "new-problems",
      label: t("maintenance.metrics.newProblems"),
      value: summary === undefined ? null : String(summary.openIssues),
      tone: (summary?.openSafetyCritical ?? 0) > 0 ? "warning" : "neutral",
      hint: t("maintenance.metrics.newProblemsHint", { count: summary?.openSafetyCritical ?? 0 }),
      link: { to: "/maintenance/problems", search: { status: "OPEN" } },
    },
    {
      id: "off-the-road",
      label: t("maintenance.overview.tiles.offTheRoad"),
      value: summary === undefined ? null : String(summary.grounded),
      tone: (summary?.grounded ?? 0) > 0 ? "warning" : "neutral",
      hint:
        summary?.firstGrounded == null
          ? t("maintenance.metrics.groundedHint")
          : t("maintenance.overview.tiles.offTheRoadSince", {
              code: summary.firstGrounded.assetCode,
              date: formatDate(summary.firstGrounded.since, language),
            }),
      // The grounded trucks are a list of trucks, so the tile opens it there.
      link: { to: "/assets/list", search: { availability: "GROUNDED" } },
    },
    {
      id: "work-orders-open",
      label: t("maintenance.overview.tiles.workOrdersOpen"),
      value: summary === undefined ? null : String(summary.openWorkOrders),
      hint: t("maintenance.overview.tiles.workOrdersOpenHint", {
        approval: summary?.waitingApproval ?? 0,
        completion: summary?.waitingCompletion ?? 0,
      }),
      link: { to: "/maintenance/work-orders", search: { only: "open" } },
    },
    {
      id: "repair-days",
      label: t("maintenance.metrics.repairDays"),
      value:
        summary?.averageRepairDays == null
          ? null
          : t("maintenance.metrics.repairDaysValue", { days: summary.averageRepairDays }),
      hint: t("maintenance.metrics.repairDaysHint", {
        count: summary?.repairsCounted ?? 0,
        window: summary?.repairWindowDays ?? 90,
      }),
    },
  ];
  // Withheld from a role that may not read work-order costs: the tile goes.
  if (summary === undefined || summary.repairCost !== null) {
    const cost = summary?.repairCost ?? null;
    tiles.push({
      id: "repair-cost",
      label: t("maintenance.overview.tiles.repairCost"),
      ...moneyMetric(cost?.amountMinor, cost?.currency),
      hint: t("maintenance.overview.tiles.repairCostHint", {
        count: cost?.workOrders ?? 0,
        window: summary?.repairWindowDays ?? 90,
      }),
      link: { to: "/maintenance/work-orders", search: { status: "COMPLETED" } },
    });
  }
  return tiles;
}

/**
 * Safety first (dashboards.html#maintenance): safety problems nobody planned,
 * then the work orders waiting on a decision, then the other problems.
 * Problems are ranked from the open list the Problems tab shows.
 */
export function maintenanceToDo(
  summary: MaintenanceSummary,
  openIssues: readonly IssueListItem[],
  t: Translate,
  language: string | undefined,
): ToDoItem[] {
  const toTriage = openIssues
    .filter((issue) => !issue.workOrders.some((order) => LIVE_WORK_ORDER.includes(order.status)))
    .sort((a, b) => Number(b.safetyCritical) - Number(a.safetyCritical) || a.reportedAt.localeCompare(b.reportedAt));
  const problem = (issue: IssueListItem): ToDoItem => ({
    key: `issue:${issue.id}`,
    icon: issue.safetyCritical ? (
      <ShieldAlert className="size-4 text-destructive" aria-hidden />
    ) : (
      <CircleAlert className="size-4" aria-hidden />
    ),
    title: t("maintenance.overview.todo.problem", { code: issue.asset.assetCode, description: issue.description }),
    detail: t(issue.safetyCritical ? "maintenance.overview.todo.reportedSafety" : "maintenance.overview.todo.reported", {
      when: formatRelativeTime(issue.reportedAt, language),
    }),
    action: {
      label: t("maintenance.overview.todo.triage"),
      to: `/assets/${issue.asset.id}/maintenance`,
      search: { panel: `issue:${issue.id}` },
    },
  });
  const waiting: ToDoItem[] = [];
  if (summary.waitingApproval > 0) {
    waiting.push({
      key: "waiting-approval",
      icon: <Clock className="size-4 text-warning-foreground" aria-hidden />,
      title: t("maintenance.overview.todo.waitingApproval", { count: summary.waitingApproval }),
      action: {
        label: t("maintenance.overview.todo.open"),
        to: "/maintenance/work-orders",
        search: { status: "SUBMITTED" },
      },
    });
  }
  if (summary.waitingCompletion > 0) {
    waiting.push({
      key: "waiting-completion",
      icon: <Clock className="size-4 text-warning-foreground" aria-hidden />,
      title: t("maintenance.overview.todo.waitingCompletion", { count: summary.waitingCompletion }),
      action: {
        label: t("maintenance.overview.todo.open"),
        to: "/maintenance/work-orders",
        search: { status: "COMPLETION_SUBMITTED" },
      },
    });
  }
  return [
    ...toTriage.filter((issue) => issue.safetyCritical).map(problem),
    ...waiting,
    ...toTriage.filter((issue) => !issue.safetyCritical).map(problem),
  ];
}
