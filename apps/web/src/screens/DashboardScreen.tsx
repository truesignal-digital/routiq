import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DashboardResponse } from "@routiq/contracts";
import { DataTable } from "@/components/data-table";
import { MetricStrip, metricTiles, moneyMetric, type MetricTile } from "@/components/metric-strip.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMeContext } from "@/auth/me.js";
import { ChartAreaInteractive, type ChartRange } from "@/dashboard/ChartAreaInteractive.js";
import { HOME_RANGE_DAYS, useDashboard } from "@/dashboard/useDashboard.js";
import {
  canOpenEntriesList,
  visibleDashboardCards,
  type DashboardCardKey,
} from "@/dashboard/cards.js";
import { canReadFinance } from "@/finance/permissions.js";
import {
  useFinanceEntryColumns,
  type FinanceEntryColumnId,
} from "@/finance/entryColumns.js";
import { useEntries } from "@/finance/useEntries.js";

const DEFAULT_RANGE: ChartRange = HOME_RANGE_DAYS;

/** Module-level so the column memo in `useFinanceEntryColumns` holds. */
const RECENT_COLUMNS: readonly FinanceEntryColumnId[] = [
  "entryNumber",
  "status",
  "economicDate",
  "category",
  "amount",
];

export function DashboardScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const [range, setRange] = useState<ChartRange>(DEFAULT_RANGE);

  const dashboard = useDashboard(range);
  // role-config: the chart sums the books (ledger readers); recent entries
  // are whatever slice the read returns this role (#264).
  const showChart = canReadFinance(me?.role, me?.enabledModules);
  const showEntries = canOpenEntriesList(me?.role, me?.enabledModules);

  return (
    <PageContainer width="wide">
      <PageHeader title={t("home.title")} />

      {dashboard.isError && (
        <ErrorState
          className="mt-6"
          message={t("home.loadFailed")}
          retryLabel={t("home.retry")}
          onRetry={() => void dashboard.refetch()}
        />
      )}

      <div className="mt-6 flex flex-col gap-6">
        <HomeTiles
          data={dashboard.data}
          isPending={dashboard.isPending}
          isError={dashboard.isError}
        />

        {showChart && (
          <ChartAreaInteractive
            series={dashboard.data?.series ?? undefined}
            currency={dashboard.data?.openPeriod?.currency ?? "XAF"}
            days={range}
            onDaysChange={setRange}
            isPending={dashboard.isPending}
          />
        )}

        {showEntries && (
          <RecentEntries
            onOpenEntry={(entryId) =>
              void navigate({
                to: "/finance/entries/$entryId",
                params: { entryId },
              })
            }
          />
        )}
      </div>
    </PageContainer>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * Home's tiles: server aggregates from `/v1/dashboard`, one per card the role
 * and modules allow. Each opens the list its number comes from.
 */
function HomeTiles({
  data,
  isPending,
  isError,
}: {
  data: DashboardResponse | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();
  const me = useMeContext();
  const entriesReachable = canOpenEntriesList(me?.role, me?.enabledModules);
  const tiles = metricTiles(
    visibleDashboardCards(me?.role, me?.enabledModules).map((key) =>
      homeTile(key, data, entriesReachable, t),
    ),
  );
  if (tiles === undefined) return null;
  return (
    <MetricStrip
      tiles={tiles}
      isPending={isPending}
      isError={isError}
      className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
    />
  );
}

function homeTile(
  key: DashboardCardKey,
  data: DashboardResponse | undefined,
  entriesReachable: boolean,
  t: Translate,
): MetricTile {
  const base = { id: key, label: t(`home.cards.${key}.title`) };

  if (key === "pendingApprovals") {
    const link = { to: "/finance/approvals" };
    if (data === undefined) return { ...base, link, value: null };
    // Null only when the API withholds finance from this caller; the tile is
    // gated to approvers, so this is the brief window before /v1/me agrees.
    // Withheld is not unrecorded, so the value is left out.
    if (data.pendingApprovals === null) {
      return {
        ...base,
        link,
        value: null,
        withheld: true,
        hint: t("home.cards.financeUnavailable"),
      };
    }
    const { count, outsideBranchCount } = data.pendingApprovals;
    return {
      ...base,
      link,
      value: String(count),
      hint: t("home.cards.pendingApprovals.description", { count }),
      // The count follows the shell's agency, so the tile says what that
      // narrowing leaves out. Widened on arrival: the queue would otherwise
      // preset itself to the very agency this line is counting around.
      ...(outsideBranchCount === 0
        ? {}
        : {
            secondary: {
              label: t("home.cards.pendingApprovals.outsideBranch", { count: outsideBranchCount }),
              to: "/finance/approvals",
              search: { branch: "all" },
            },
          }),
    };
  }

  if (key === "assets") {
    return {
      ...base,
      link: { to: "/assets" },
      value: data === undefined ? null : String(data.assets.byStatus.IN_SERVICE),
      ...(data === undefined
        ? {}
        : { hint: t("home.cards.assets.description", { count: data.assets.total }) }),
    };
  }

  const openPeriod = data?.openPeriod;
  const direction = key === "openPeriodExpense" ? "EXPENSE" : "REVENUE";
  const link = entriesReachable
    ? {
        link: {
          to: "/finance/entries",
          search: { periodCode: openPeriod?.periodCode, status: "LEDGER", direction },
        },
      }
    : {};
  if (data === undefined) return { ...base, ...link, value: null };
  // No open period means nothing has been posted yet: said in words, never a
  // zero, because a zero would claim the period balanced (§3.4).
  if (openPeriod == null) {
    return { ...base, ...link, value: null, hint: t("home.cards.noOpenPeriod") };
  }
  const minor =
    key === "openPeriodExpense" ? openPeriod.postedExpenseMinor : openPeriod.postedRevenueMinor;
  return {
    ...base,
    ...link,
    ...moneyMetric(minor, openPeriod.currency),
    hint: t("home.cards.periodDescription", { period: openPeriod.periodCode }),
  };
}

/**
 * The first keyset page of the entries read, unfiltered. No pager and no load
 * more: the home screen shows what just happened, and the entries list owns
 * everything past that.
 */
function RecentEntries({ onOpenEntry }: { onOpenEntry: (entryId: string) => void }) {
  const { t } = useTranslation();
  const columns = useFinanceEntryColumns(RECENT_COLUMNS);
  const entriesQuery = useEntries();
  const entries = entriesQuery.data?.pages[0]?.entries ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("home.recent.title")}</CardTitle>
        <CardAction>
          <Link to="/finance/entries" className="text-sm font-medium underline-offset-4 hover:underline">
            {t("home.recent.viewAll")}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {entriesQuery.isError ? (
          <ErrorState
            message={t("home.recent.loadFailed")}
            retryLabel={t("home.retry")}
            onRetry={() => void entriesQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={entries}
            showRowCount={false}
            primaryColumn={{ columnId: "entryNumber" }}
            onRowClick={(entry) => onOpenEntry(entry.id)}
            emptyState={
              entriesQuery.isPending ? (
                <LoadingState label={t("home.recent.loading")} />
              ) : (
                <EmptyState
                  icon={<FileText className="size-7" aria-hidden />}
                  message={t("home.recent.empty")}
                />
              )
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
