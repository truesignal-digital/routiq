import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { OverviewSeriesPoint } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatCompact, formatMoney, formatMonth, profitOrLoss } from "@/lib/format.js";
import { ChartViewToggle } from "@/components/overview/chart-view-toggle.js";
import type { DashboardMode } from "./money-view.js";

const CONFIG = {
  revenue: { label: "", color: "var(--series-1)" },
  expense: { label: "", color: "var(--series-2)" },
} satisfies ChartConfig;

function shortMonth(periodCode: string, language: string | undefined): string {
  const [year, month] = periodCode.split("-").map(Number);
  if (year === undefined || month === undefined) return periodCode;
  return new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * Revenue and expenses per month, the 12 closed months (dashboards.html):
 * one axis, a line each (an unfilled area: the chart kind Home already loads), a label at each line's end, exact values on hover
 * and a table view. An internal fleet sees the expenses line alone.
 */
export function MoneyMonthsChart({
  series,
  currency,
  mode,
}: {
  series: readonly OverviewSeriesPoint[];
  currency: string;
  mode: DashboardMode;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const [view, setView] = useState<"chart" | "table">("chart");
  const profit = mode === "profit";
  const last = series[series.length - 1];
  const revenueOnTop = last === undefined || last.revenueMinor >= last.expenseMinor;
  const data = series.map((point) => ({
    periodCode: point.periodCode,
    month: shortMonth(point.periodCode, language),
    revenue: point.revenueMinor,
    expense: point.expenseMinor,
  }));

  return (
    <div data-slot="money-months" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        {profit && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-[3px] w-3.5 rounded-sm bg-series-1" />
            {t("dashboard.months.revenue")}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-[3px] w-3.5 rounded-sm bg-series-2" />
          {t("dashboard.months.expenses")}
        </span>
      </div>
      {view === "table" ? (
        <MonthsTable series={series} currency={currency} profit={profit} />
      ) : (
        <ChartContainer config={CONFIG} className="aspect-auto h-[200px] w-full">
          <AreaChart data={data} margin={{ top: 8, right: 64, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={6} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(value: number) => formatCompact(value, language)} />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (active !== true || point === undefined) return null;
                return (
                  <div className="min-w-40 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                    <p className="font-medium">{formatMonth(point.periodCode, language)}</p>
                    {profit && (
                      <TipRow color="bg-series-1" label={t("dashboard.months.revenue")} value={formatMoney(point.revenue, { currency })} />
                    )}
                    <TipRow color="bg-series-2" label={t("dashboard.months.expenses")} value={formatMoney(point.expense, { currency })} />
                    {profit && (
                      <TipRow
                        label={profitOrLoss(point.revenue - point.expense, { currency }).label}
                        value={profitOrLoss(point.revenue - point.expense, { currency }).amount}
                      />
                    )}
                  </div>
                );
              }}
            />
            {profit && (
              <Area
                dataKey="revenue"
                type="monotone"
                fillOpacity={0}
                stroke="var(--color-revenue)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                label={endLabel(data.length, t("dashboard.months.revenue"), revenueOnTop ? "above" : "below")}
              />
            )}
            <Area
              dataKey="expense"
              type="monotone"
              fillOpacity={0}
              stroke="var(--color-expense)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              label={endLabel(data.length, t("dashboard.months.expenses"), profit && revenueOnTop ? "below" : "above")}
            />
          </AreaChart>
        </ChartContainer>
      )}
      <ChartViewToggle view={view} onChange={setView} />
    </div>
  );
}

/**
 * The series name at the end of its line, in the text colour (insights.html,
 * chart rules). Both sit above their line's end, the higher line's a row
 * higher, so two lines ending close together never print over each other or
 * over the month axis.
 */
function endLabel(count: number, name: string, place: "above" | "below") {
  return ({ x, y, index }: { x?: number | string | undefined; y?: number | string | undefined; index?: number | undefined }) =>
    index === count - 1 ? (
      <text x={Number(x) + 6} y={Number(y) + (place === "above" ? -16 : -4)} fontSize={11} className="fill-foreground">
        {name}
      </text>
    ) : null;
}

function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-4 tabular-nums">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {color !== undefined && <i className={`inline-block size-2.5 rounded-[2px] ${color}`} />}
        {label}
      </span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

interface MonthRow {
  periodCode: string;
  revenueMinor: number;
  expenseMinor: number;
}

function MonthsTable({
  series,
  currency,
  profit,
}: {
  series: readonly OverviewSeriesPoint[];
  currency: string;
  profit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const money = (minor: number) => formatMoney(minor, { currency });
  const columns: DataTableColumn<MonthRow>[] = [
    {
      id: "month",
      header: t("dashboard.months.month"),
      meta: { phone: "title", label: t("dashboard.months.month") },
      cell: ({ row }) => formatMonth(row.original.periodCode, language),
    },
    ...(profit
      ? [
          {
            id: "revenue",
            header: t("dashboard.months.revenue"),
            meta: { phone: "meta", label: t("dashboard.months.revenue"), phoneText: (row: MonthRow) => money(row.revenueMinor) },
            cell: ({ row }) => <span className="tabular-nums">{money(row.original.revenueMinor)}</span>,
          } satisfies DataTableColumn<MonthRow>,
        ]
      : []),
    {
      id: "expenses",
      header: t("dashboard.months.expenses"),
      meta: { phone: profit ? "meta" : "value", label: t("dashboard.months.expenses"), phoneText: (row) => money(row.expenseMinor) },
      cell: ({ row }) => <span className="tabular-nums">{money(row.original.expenseMinor)}</span>,
    },
    ...(profit
      ? [
          {
            id: "profit",
            header: t("common.profit"),
            meta: {
              phone: "value",
              label: t("common.profit"),
              phoneText: (row: MonthRow) => profitOrLoss(row.revenueMinor - row.expenseMinor, { currency }).text,
            },
            cell: ({ row }) => (
              <span className="font-semibold tabular-nums">
                {profitOrLoss(row.original.revenueMinor - row.original.expenseMinor, { currency }).text}
              </span>
            ),
          } satisfies DataTableColumn<MonthRow>,
        ]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      data={[...series].reverse()}
      getRowId={(row) => row.periodCode}
      showRowCount={false}
    />
  );
}
