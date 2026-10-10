import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, CircleDollarSign, Receipt } from "lucide-react";
import type { AssetFinanceResponse, FinancialEntryListItem } from "@routiq/contracts";
import { useWorkspaceMonth } from "@/auth/workspace-day.js";
import { FilterChips } from "@/components/filter-chips";
import { MetricStrip, moneyMetric, type MetricTile, type MetricTiles } from "@/components/metric-strip.js";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { PermissionDenied } from "@/components/permission-denied.js";
import { RecordText } from "@/components/record-number";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCategories } from "@/categories/useCategories.js";
import { formatDate, formatMoney, localizedLabel, type MoneySign } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { contributes } from "@/modules/manifest.js";
import { useVehicle } from "../context.js";
import { entrySteps } from "../flow.js";
import { recordReference } from "../model.js";
import { CardHead, LinkButton, RecordRow, RowIcon, RowMenu, Sep, SubHead, TabAction, TabHeader } from "../parts.js";
import { EntryEventStatus, foldedAmountClass } from "@/finance/EntryCancellation.js";
import { EvidenceMark } from "../panel/shared.js";
import { useAssetFinance, useVehicleEntries, type VehicleEntriesFilter } from "../useVehicle.js";
import { periodLabel } from "./NowTab.js";

type Chip = "posted" | "expenses" | "revenue" | "review" | "rejected" | "missing";

interface MoneySearch {
  period?: string;
  entries?: "posted" | "review" | "rejected";
  direction?: "EXPENSE" | "REVENUE";
  evidence?: "missing";
}

function chipOf(search: MoneySearch): Chip {
  if (search.evidence === "missing") return "missing";
  if (search.entries === "review") return "review";
  if (search.entries === "rejected") return "rejected";
  if (search.direction === "EXPENSE") return "expenses";
  if (search.direction === "REVENUE") return "revenue";
  return "posted";
}

function searchOf(chip: Chip): Omit<MoneySearch, "period"> {
  switch (chip) {
    case "posted":
      return {};
    case "expenses":
      return { direction: "EXPENSE" };
    case "revenue":
      return { direction: "REVENUE" };
    case "review":
      return { entries: "review" };
    case "rejected":
      return { entries: "rejected" };
    case "missing":
      return { evidence: "missing" };
  }
}

/**
 * Each chip is a query with its basis named: posted money by POSTING period,
 * pending and rejected by ECONOMIC month; missing receipts across all months.
 */
export function entriesFilter(chip: Chip, period: string): VehicleEntriesFilter {
  switch (chip) {
    case "posted":
      return { status: "LEDGER", periodCode: period };
    case "expenses":
      return { status: "LEDGER", periodCode: period, direction: "EXPENSE" };
    case "revenue":
      return { status: "LEDGER", periodCode: period, direction: "REVENUE" };
    case "review":
      return { status: "SUBMITTED", economicMonth: period };
    case "rejected":
      return { status: "REJECTED", economicMonth: period };
    case "missing":
      return { evidence: "MISSING" };
  }
}

export function shiftMonth(period: string, by: number): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MoneyTab() {
  const { t } = useTranslation();
  const { gates } = useVehicle();
  if (!gates.money) {
    return (
      <PermissionDenied
        title={t("vehicle.tabs.money")}
        icon={<Receipt className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }
  return <MoneySection />;
}

/** This vehicle's share of every entry, one month at a time. */
function MoneySection() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as MoneySearch;
  const { asset } = useVehicle();
  const locale = i18n.language;
  const thisMonth = useWorkspaceMonth();
  const period = search.period ?? thisMonth;
  const financeQuery = useAssetFinance(asset.id, period, true);
  const chip = chipOf(search);
  const entriesQuery = useVehicleEntries(asset.id, entriesFilter(chip, period), true);
  const revenueTypes = useCategories("REVENUE_CATEGORY");
  const finance = financeQuery.data;
  const money = (minor: number, sign?: MoneySign) =>
    formatMoney(minor, { currency: asset.currency, locale, ...(sign === undefined ? {} : { sign }) });

  const go = (next: Partial<MoneySearch>) =>
    void navigate({
      to: ".",
      search: (previous: { period?: string | undefined; panel?: string | undefined }) => ({
        period: previous.period,
        panel: previous.panel,
        ...next,
      }),
      replace: true,
    });

  const entries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const lifetime = asset.finance;

  return (
    <div className="space-y-7">
      <TabHeader
        title={t("vehicle.money.titleFor", { period: periodLabel(period, locale) })}
        description={t("vehicle.money.description")}
        action={
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex items-center" role="group" aria-label={t("vehicle.money.periodLabel")}>
              <Button
                variant="ghost"
                size="desktop-icon-sm"
                aria-label={t("vehicle.money.periodPrev")}
                onClick={() => go({ ...searchOf(chip), period: shiftMonth(period, -1) })}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="desktop-icon-sm"
                aria-label={t("vehicle.money.periodNext")}
                disabled={period >= thisMonth}
                onClick={() => go({ ...searchOf(chip), period: shiftMonth(period, 1) })}
              >
                <ChevronRight aria-hidden />
              </Button>
            </div>
            <TabAction actionKey="record-expense" />
          </div>
        }
      />

      {financeQuery.isPending ? (
        <LoadingState label={t("vehicle.money.loading")} rows={2} />
      ) : financeQuery.isError || finance === undefined ? (
        <ErrorState
          message={t("vehicle.money.loadFailed")}
          retryLabel={t("vehicle.panel.retry")}
          onRetry={() => void financeQuery.refetch()}
        />
      ) : (
        <>
          <PeriodTiles
            finance={finance}
            currency={asset.currency}
            showRevenue={(revenueTypes.data?.length ?? 0) > 0}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="gap-0 py-0">
              <CardHead
                title={t("vehicle.money.byCategory")}
                description={t("vehicle.money.byCategoryHint", { period: periodLabel(period, locale) })}
              />
              <CategoryBars finance={finance} money={money} />
            </Card>
            <Card className="gap-0 py-0">
              <CardHead title={t("vehicle.money.lastSixMonths")} description={t("vehicle.money.lastSixMonthsHint")} />
              <MonthlyBars finance={finance} money={money} />
            </Card>
          </div>
        </>
      )}

      <section>
        <SubHead title={t("vehicle.money.entries")} description={t("vehicle.money.entriesHint")} />
        <div className="mb-3">
          <FilterChips
            label={t("vehicle.money.filterLabel")}
            options={[
              { key: "posted", label: t("vehicle.money.filters.posted"), count: finance?.posted.eventCount },
              { key: "expenses", label: t("vehicle.money.filters.expenses") },
              { key: "revenue", label: t("vehicle.money.filters.revenue") },
              { key: "review", label: t("vehicle.money.filters.review"), count: finance?.pending.entryCount },
              { key: "rejected", label: t("vehicle.money.filters.rejected"), count: finance?.rejected.entryCount },
              { key: "missing", label: t("vehicle.money.filters.missing") },
            ]}
            value={chip}
            onChange={(next) => go(searchOf(next))}
          />
        </div>
        {entriesQuery.isPending ? (
          <LoadingState label={t("vehicle.money.loading")} />
        ) : entriesQuery.isError ? (
          <ErrorState
            message={t("vehicle.money.loadFailed")}
            retryLabel={t("vehicle.panel.retry")}
            onRetry={() => void entriesQuery.refetch()}
          />
        ) : entries.length === 0 ? (
          <EmptyState icon={<Receipt className="size-6" aria-hidden />} message={t("vehicle.money.noEntries")} />
        ) : (
          <>
            <Card className="gap-0 py-0">
              <ul className="divide-y">
                {entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </Card>
            {entriesQuery.hasNextPage && (
              <Button
                variant="outline"
                className="mt-3 desktop:h-9"
                disabled={entriesQuery.isFetchingNextPage}
                onClick={() => void entriesQuery.fetchNextPage()}
              >
                {t("vehicle.history.loadMore")}
              </Button>
            )}
          </>
        )}
      </section>

      {/* The detail carries it only for ledger readers; this section is theirs anyway. */}
      {lifetime !== undefined && (
        <p className="border-t pt-4 text-xs text-muted-foreground">
          {t("vehicle.money.lifetime", {
            revenue: money(lifetime.revenueMinor),
            expenses: money(lifetime.expenseMinor),
            net: money(lifetime.netMinor, { context: "net" }),
          })}
        </p>
      )}
    </div>
  );
}

/** The month at a glance, from the asset finance read; nothing is counted here. */
function PeriodTiles({
  finance,
  currency,
  showRevenue,
}: {
  finance: AssetFinanceResponse;
  currency: string;
  showRevenue: boolean;
}) {
  const { t } = useTranslation();
  const missing = finance.evidenceMissing.postedCount + finance.evidenceMissing.pendingCount;
  const posted: MetricTile = {
    id: "posted",
    label: t("vehicle.money.posted"),
    ...moneyMetric(finance.posted.expenseMinor, currency),
    hint: t("vehicle.money.postedHint"),
    info: t("vehicle.money.postedBasis"),
  };
  const review: MetricTile = {
    id: "review",
    label: t("vehicle.money.review"),
    ...moneyMetric(finance.pending.expenseMinor, currency),
    hint: t("vehicle.money.reviewHint", { count: finance.pending.entryCount }),
    tone: finance.pending.entryCount > 0 ? "warning" : "neutral",
    info: t("vehicle.money.economicBasis"),
  };
  const missingTile: MetricTile = {
    id: "missing",
    label: t("vehicle.money.missing"),
    value: t("vehicle.money.entryCount", { count: missing }),
    hint: t("vehicle.money.missingHint"),
    tone: missing > 0 ? "warning" : "neutral",
  };
  const tiles: MetricTiles = showRevenue
    ? [
        posted,
        review,
        missingTile,
        {
          id: "revenue",
          label: t("vehicle.money.revenue"),
          ...moneyMetric(finance.posted.revenueMinor, currency),
          hint: t("vehicle.money.revenueHint"),
          info: t("vehicle.money.postedBasis"),
        },
      ]
    : [posted, review, missingTile];
  return (
    <MetricStrip
      tiles={tiles}
      className={showRevenue ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3"}
    />
  );
}

function CategoryBars({
  finance,
  money,
}: {
  finance: AssetFinanceResponse;
  money: (minor: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const categories = finance.byCategory;
  const total = categories.reduce((sum, category) => sum + category.expenseMinor, 0);
  const max = Math.max(1, ...categories.map((category) => category.expenseMinor));
  if (categories.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{t("vehicle.money.noPostedExpenses")}</p>;
  }
  return (
    <div className="space-y-4 p-4">
      <ul className="space-y-3.5">
        {categories.map((category) => (
          <li key={category.code}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-medium">{localizedLabel(category, i18n.language)}</span>
                <span className="text-xs text-muted-foreground">{t(`vehicle.layers.${category.layer}`)}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {money(category.expenseMinor)}
                {/* A month that nets to nothing or less has no shares (#472). */}
                {total > 0 && (
                  <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">
                    {Math.round((category.expenseMinor / total) * 100)}%
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-sm bg-foreground/70"
                style={{ width: `${Math.max(0, (category.expenseMinor / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">{t("vehicle.money.totalPosted")}</span>
        <span className="font-semibold tabular-nums">{money(total)}</span>
      </p>
    </div>
  );
}

function MonthlyBars({
  finance,
  money,
}: {
  finance: AssetFinanceResponse;
  money: (minor: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const months = finance.series;
  const [selected, setSelected] = useState(months.length - 1);
  const max = Math.max(1, ...months.flatMap((month) => [month.expenseMinor, month.revenueMinor]));
  const current = months[selected];
  const height = (value: number) => `${Math.max(2, Math.round((Math.max(0, value) / max) * 132))}px`;
  const short = (period: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" }).format(
      new Date(`${period}-15T00:00:00Z`),
    );

  return (
    <div className="p-4">
      <div className="flex h-44 items-end gap-1.5 sm:gap-2" role="list">
        {months.map((month, index) => (
          <button
            key={month.periodCode}
            type="button"
            role="listitem"
            onMouseEnter={() => setSelected(index)}
            onFocus={() => setSelected(index)}
            onClick={() => setSelected(index)}
            aria-label={t("vehicle.money.monthBar", {
              month: periodLabel(month.periodCode, i18n.language),
              expenses: money(month.expenseMinor),
              revenue: money(month.revenueMinor),
            })}
            className={cn(
              "flex h-full flex-1 flex-col justify-end gap-1.5 rounded-md px-1 pt-2 pb-1.5 transition-colors",
              index === selected ? "bg-muted" : "hover:bg-muted/50",
            )}
          >
            <span className="flex items-end justify-center gap-1">
              <span className="w-3 rounded-t-[3px] bg-foreground/75 sm:w-4" style={{ height: height(month.expenseMinor) }} />
              <span className="w-3 rounded-t-[3px] bg-foreground/20 sm:w-4" style={{ height: height(month.revenueMinor) }} />
            </span>
            <span className={cn("text-xs", index === selected ? "font-medium text-foreground" : "text-muted-foreground")}>
              {short(month.periodCode)}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium">{current === undefined ? "" : periodLabel(current.periodCode, i18n.language)}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-foreground/75" aria-hidden />
            {t("vehicle.money.expenses")}
            <span className="font-medium text-foreground tabular-nums">
              {current === undefined ? "" : money(current.expenseMinor)}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-foreground/20" aria-hidden />
            {t("vehicle.money.revenueLegend")}
            <span className="font-medium text-foreground tabular-nums">
              {current === undefined ? "" : money(current.revenueMinor)}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: FinancialEntryListItem }) {
  const { t, i18n } = useTranslation();
  const { viewer, panel } = useVehicle();
  const locale = i18n.language;
  const revenue = entry.direction === "REVENUE";
  const share = entry.assetShareMinor ?? entry.amountMinor;
  const split = share !== entry.amountMinor;
  const steps = entrySteps(entry, viewer);
  const links = entry.assetLinks;
  const money = (minor: number, sign?: MoneySign) =>
    formatMoney(minor, { currency: entry.currency, locale, ...(sign === undefined ? {} : { sign }) });

  return (
    <RecordRow
      icon={<RowIcon icon={revenue ? CircleDollarSign : Receipt} tone={revenue ? "success" : "neutral"} />}
      title={
        <>
          {localizedLabel(entry.category, locale)}
          {entry.counterpartyName !== null && (
            <span className="font-normal text-muted-foreground"> · {entry.counterpartyName}</span>
          )}
        </>
      }
      detail={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="tabular-nums">{entry.entryNumber}</span>
          <Sep />
          <span>{formatDate(entry.economicDate, locale)}</span>
          {entry.category.layer !== null && (
            <>
              <Sep />
              <span>{t(`vehicle.layers.${entry.category.layer}`)}</span>
            </>
          )}
          {links?.activityId != null && contributes("fields", "entry.tripLink", viewer.enabledModules) && (
            <>
              <Sep />
              <LinkButton
                className="font-normal text-muted-foreground"
                onClick={() => panel.openRecord({ kind: "trip", id: links.activityId ?? "" })}
              >
                <RecordText
                  text={t("vehicle.money.forTrip", { number: links.activityNumber ?? "" })}
                  numbers={[links.activityNumber]}
                />
              </LinkButton>
            </>
          )}
          {links?.workOrderId != null && contributes("fields", "entry.workOrderLink", viewer.enabledModules) && (
            <>
              <Sep />
              <LinkButton
                className="font-normal text-muted-foreground"
                onClick={() => panel.openRecord({ kind: "work_order", id: links.workOrderId ?? "" })}
              >
                {t("vehicle.money.forWorkOrder", { ref: recordReference(links.workOrderId) })}
              </LinkButton>
            </>
          )}
        </span>
      }
      status={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-col md:items-start">
          <EntryEventStatus entry={entry} />
          <EvidenceMark entry={entry} quiet />
        </span>
      }
      aside={
        <>
          <div className={cn("font-medium", foldedAmountClass(entry))}>
            {money(share, { context: "ledger", direction: entry.direction })}
          </div>
          {split && (
            <div className="text-xs text-muted-foreground">
              {t("vehicle.money.ofEntry", { amount: money(entry.amountMinor, { context: "record" }) })}
            </div>
          )}
        </>
      }
      menu={<RowMenu label={entry.entryNumber} steps={steps.offered} onStep={panel.openStep} />}
      onOpen={() => panel.openRecord({ kind: "entry", id: entry.id })}
    />
  );
}
