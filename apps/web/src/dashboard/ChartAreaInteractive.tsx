import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartNoAxesColumn } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DashboardSeriesPoint } from "@routiq/contracts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/page";
import { formatDate, formatMoney } from "@/lib/format.js";

/** Widest first, the way the range reads on the card. */
export const CHART_RANGES = [90, 30, 7] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/** The slot the chart occupies, held even when there is nothing to draw. */
const CHART_HEIGHT = "h-[250px]";

interface ChartPoint {
  date: string;
  expense: number;
  revenue: number;
}

export function ChartAreaInteractive({
  series,
  currency,
  days,
  onDaysChange,
  isPending,
}: {
  series: DashboardSeriesPoint[] | undefined;
  currency: string;
  days: ChartRange;
  onDaysChange: (days: ChartRange) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();

  const chartConfig = useMemo(
    () =>
      ({
        expense: { label: t("home.chart.expense"), color: "var(--chart-2)" },
        revenue: { label: t("home.chart.revenue"), color: "var(--chart-4)" },
      }) satisfies ChartConfig,
    [t],
  );

  const points = useMemo<ChartPoint[]>(
    () =>
      (series ?? []).map((point) => ({
        date: point.date,
        expense: point.expenseMinor,
        revenue: point.revenueMinor,
      })),
    [series],
  );

  // A window where nothing was posted is a real answer, but an area chart of
  // flat zeros looks like a rendering failure — so it gets said in words.
  const hasMovement = points.some(
    (point) => point.expense !== 0 || point.revenue !== 0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("home.chart.title")}</CardTitle>
        <CardDescription>{t("home.chart.description")}</CardDescription>
        <CardAction>
          <Tabs
            value={String(days)}
            onValueChange={(value: unknown) => {
              const next = CHART_RANGES.find((range) => String(range) === value);
              if (next !== undefined) onDaysChange(next);
            }}
          >
            <TabsList aria-label={t("home.chart.rangeLabel")}>
              {CHART_RANGES.map((range) => (
                <TabsTrigger key={range} value={String(range)}>
                  {t(`home.chart.range.${range}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <Skeleton className={`w-full ${CHART_HEIGHT}`} />
        ) : hasMovement ? (
          <ChartContainer config={chartConfig} className={`aspect-auto w-full ${CHART_HEIGHT}`}>
            <AreaChart data={points} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="routiq-chart-expense" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-expense)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-expense)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="routiq-chart-revenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value: string) => formatDate(value)}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) => formatDate(String(value))}
                    formatter={(value, name, item) => (
                      <>
                        <span
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: item.color }}
                          aria-hidden
                        />
                        <span className="flex flex-1 items-center justify-between gap-4 leading-none">
                          <span className="text-muted-foreground">
                            {chartConfig[String(name) as keyof typeof chartConfig]?.label ??
                              String(name)}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatMoney(Number(value), { currency })}
                          </span>
                        </span>
                      </>
                    )}
                  />
                }
              />
              {/* Monotone, never "natural": a natural spline overshoots around an
                  isolated spike and draws money below zero that was never posted (#56). */}
              <Area
                dataKey="revenue"
                type="monotone"
                fill="url(#routiq-chart-revenue)"
                stroke="var(--color-revenue)"
              />
              <Area
                dataKey="expense"
                type="monotone"
                fill="url(#routiq-chart-expense)"
                stroke="var(--color-expense)"
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className={`flex w-full items-center ${CHART_HEIGHT}`}>
            <EmptyState
              className="w-full"
              icon={<ChartNoAxesColumn className="size-7" aria-hidden />}
              message={t("home.chart.empty")}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
