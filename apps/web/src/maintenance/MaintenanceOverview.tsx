import { Link } from "@tanstack/react-router";
import type { FleetUsageResponse, IssueListItem, MaintenanceSummary } from "@routiq/contracts";
import { OPEN_WORK_ORDER_STATUSES } from "@routiq/contracts";
import { CircleAlert, Clock, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MetricStrip, metricTiles, moneyMetric, type MetricTile } from "@/components/metric-strip.js";
import { InfoPopover } from "@/components/info-popover.js";
import { MonthColumns } from "@/components/overview/month-columns.js";
import { OverviewSummary } from "@/components/overview/overview-summary.js";
import { ToDoList, type ToDoItem } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { StatusBadge } from "@/components/status-badge.js";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatDate, formatMonth, formatRelativeTime } from "@/lib/format.js";
import { PAGE_USAGE_RANGE, useFleetUsage } from "@/overview/useFleetUsage.js";
import { useIssues, useMaintenanceSummary } from "./useMaintenance.js";

type Translate = ReturnType<typeof useTranslation>["t"];

const LIVE_WORK_ORDER: readonly string[] = OPEN_WORK_ORDER_STATUSES;

/** The rows To do shows; the one it hides is always the other problems, so See all opens them. */
const TO_DO_ROWS = 3;

const LINK_CLASS =
  "inline-flex min-h-11 items-center text-sm font-medium whitespace-nowrap underline-offset-4 hover:underline desktop:min-h-6";

/**
 * Maintenance › Overview (#665, dashboards.html#maintenance), journey-first
 * (tools/verify/journeys/technician-opens-work.ts, admin-triages-problems.ts):
 * what needs the workshop comes first, then the summary notice when it is due
 * (#667), then what is off the road, for how long and at what cost. The tiles
 * carry the grounding, the safety count and the window the figures cover, so
 * the summary has no counted line repeating them. Repair cost
 * comes from work orders only, and only for the roles allowed to read it;
 * nothing here is revenue or profit, so a technician sees all of it.
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
  const todo = summary === undefined ? [] : maintenanceToDo(summary, openIssues, t, language);

  return (
    <div data-slot="maintenance-overview" className="flex flex-col gap-5">
      {summaryQuery.isError && (
        <ErrorState
          message={t("maintenance.overview.loadFailed")}
          retryLabel={t("maintenance.retry")}
          onRetry={() => void summaryQuery.refetch()}
        />
      )}
      {/* People act first: what waits leads, three rows so the tiles stay in the first view. */}
      <Card data-slot="maintenance-todo">
        <CardHeader>
          <CardTitle>{t("maintenance.overview.todo.title")}</CardTitle>
          {todo.length > TO_DO_ROWS && (
            <CardAction>
              <Link to="/maintenance/problems" search={{ status: "OPEN" }} className={LINK_CLASS}>
                {t("maintenance.overview.todo.seeAll")}
              </Link>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {summary === undefined || issuesQuery.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ToDoList items={todo} empty={t("maintenance.overview.todo.empty")} limit={TO_DO_ROWS} />
          )}
        </CardContent>
      </Card>
      <OverviewSummary
        page="maintenance"
        notice={summary?.notice}
        sentence={
          summary === undefined
            ? undefined
            : summary.openSafetyCritical > 0
              ? t("maintenance.overview.summary.sentenceSafety", { open: summary.openIssues, safety: summary.openSafetyCritical })
              : t("maintenance.overview.summary.sentence", { open: summary.openIssues })
        }
        details={summary === undefined ? undefined : [t("maintenance.overview.summary.grounded", { grounded: summary.grounded })]}
        badge={
          summary === undefined || summary.grounded === 0 ? undefined : (
            <StatusBadge tone="warning" icon={null}>
              {t("maintenance.overview.summary.badge", { count: summary.grounded })}
            </StatusBadge>
          )
        }
        counted={null}
      >
        {tiles !== undefined && (
          <MetricStrip tiles={tiles} isPending={summaryQuery.isPending} isError={summaryQuery.isError} />
        )}
      </OverviewSummary>
      {/* Maintenance off: no day is counted off the road, so the chart goes. */}
      {(usageQuery.isPending || usageQuery.isError || usageQuery.data?.offRoadByMonth != null) && (
        <OffRoadCard usage={usageQuery.data} isError={usageQuery.isError} onRetry={() => void usageQuery.refetch()} />
      )}
    </div>
  );
}

function shortMonth(periodCode: string, language: string | undefined, month: "short" | "long"): string {
  return formatMonth(periodCode, language, { month, year: false });
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
        <CardTitle className="flex items-center gap-1.5">
          {t("maintenance.overview.offRoad.title")}
          <InfoPopover label={t("common.howCalculated")}>{t("maintenance.overview.offRoad.counted")}</InfoPopover>
        </CardTitle>
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
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted-foreground">
          {/* The current month is still running: said at rest, so its short column isn't read as a good month. */}
          {partial !== undefined && usage !== undefined && (
            <span>
              {t("maintenance.overview.offRoad.partial", {
                month: shortMonth(partial.periodCode, language, "long"),
                days: Number(usage.businessDate.slice(8, 10)),
              })}
            </span>
          )}
          <Link to="/maintenance/work-orders" className={`ms-auto text-foreground ${LINK_CLASS}`}>
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
      ...waitingHint(summary, t),
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

/** What the open work orders wait for; nothing when none waits on a decision. */
function waitingHint(summary: MaintenanceSummary | undefined, t: Translate): { hint?: string } {
  const approval = summary?.waitingApproval ?? 0;
  const completion = summary?.waitingCompletion ?? 0;
  if (approval > 0 && completion > 0) return { hint: t("maintenance.overview.tiles.workOrdersOpenHint", { approval, completion }) };
  if (approval > 0) return { hint: t("maintenance.overview.tiles.waitingApproval", { count: approval }) };
  if (completion > 0) return { hint: t("maintenance.overview.tiles.waitingCompletion", { count: completion }) };
  return {};
}

/**
 * Safety first (dashboards.html#maintenance): safety problems nobody planned,
 * then the work orders waiting on a decision, then the other problems.
 * Problems are ranked from the open list the Problems tab shows. One row per
 * kind: a single problem names itself, several become one counted row that
 * opens them on the Problems tab. So there are at most four rows, and the
 * fourth is always the other problems.
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
  const kind = (issues: readonly IssueListItem[], safety: boolean): ToDoItem[] => {
    const [only] = issues;
    if (only === undefined) return [];
    if (issues.length === 1) return [problem(only)];
    return [
      {
        key: safety ? "safety-problems" : "other-problems",
        icon: safety ? <ShieldAlert className="size-4 text-destructive" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />,
        title: t(safety ? "maintenance.overview.todo.safetyProblems" : "maintenance.overview.todo.otherProblems", {
          count: issues.length,
        }),
        action: { label: t("maintenance.overview.todo.triage"), to: "/maintenance/problems", search: { status: "OPEN" } },
      },
    ];
  };
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
    ...kind(toTriage.filter((issue) => issue.safetyCritical), true),
    ...waiting,
    ...kind(toTriage.filter((issue) => !issue.safetyCritical), false),
  ];
}
