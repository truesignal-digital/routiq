import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/data-table";
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
import { SectionCards } from "@/dashboard/SectionCards.js";
import { useDashboard } from "@/dashboard/useDashboard.js";
import { canOpenEntriesList } from "@/dashboard/cards.js";
import {
  useFinanceEntryColumns,
  type FinanceEntryColumnId,
} from "@/finance/entryColumns.js";
import { useEntries } from "@/finance/useEntries.js";

const DEFAULT_RANGE: ChartRange = 90;

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
  const showFinance = canOpenEntriesList(me?.role, me?.enabledModules);

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
        <SectionCards data={dashboard.data} isPending={dashboard.isPending} />

        {(me?.enabledModules.includes("FINANCE") ?? false) && (
          <ChartAreaInteractive
            series={dashboard.data?.series}
            currency={dashboard.data?.openPeriod?.currency ?? "XAF"}
            days={range}
            onDaysChange={setRange}
            isPending={dashboard.isPending}
          />
        )}

        {showFinance && (
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
