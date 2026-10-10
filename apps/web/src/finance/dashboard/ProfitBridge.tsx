import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompact, formatMoney, localizedLabel, profitOrLoss } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";
import type { BridgeStep } from "./bridge.js";
import { ChartViewToggle } from "./ChartViewToggle.js";

const CONFIG = {
  range: { label: "", color: "var(--series-1)" },
} satisfies ChartConfig;

interface Labelled {
  step: BridgeStep;
  label: string;
}

/**
 * "What changed the profit" (dashboards.html, ProfitBridge): a waterfall from
 * the comparison window's profit to this window's on a wide screen, and on a
 * phone, or as its table view, a list that adds up top to bottom. Blue raised
 * the profit, orange lowered it; the two totals are drawn in the text colour.
 */
export function ProfitBridge({
  steps,
  currency,
  periodLabel,
  comparisonLabel,
}: {
  steps: readonly BridgeStep[];
  currency: string;
  /** Short window labels for the first and last bar ("Sep 1 – 9", "Oct 1 – 9"). */
  periodLabel: string;
  comparisonLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const [view, setView] = useState<"chart" | "table">("chart");
  const language = i18n.resolvedLanguage;

  const labelled: Labelled[] = steps.map((step) => ({ step, label: stepLabel(step) }));
  function stepLabel(step: BridgeStep): string {
    if (step.kind === "total") return step.key === "start" ? comparisonLabel : periodLabel;
    switch (step.what) {
      case "revenue":
        return t("dashboard.bridge.revenue");
      case "category":
        return step.category === undefined ? "" : localizedLabel(step.category, language);
      case "otherCategories":
        return t("dashboard.bridge.otherCategories", { count: step.foldedCount ?? 0 });
      case "noCategory":
        return t("dashboard.bridge.noCategory");
      case "companyCosts":
        return t("dashboard.bridge.companyCosts");
    }
  }

  const showList = isMobile || view === "table";
  return (
    <div data-slot="profit-bridge" className="flex flex-col gap-2">
      {showList ? (
        <BridgeList labelled={labelled} currency={currency} />
      ) : (
        <BridgeChart labelled={labelled} currency={currency} />
      )}
      {!isMobile && <ChartViewToggle view={view} onChange={setView} />}
    </div>
  );
}

/** A change on profit: "+660 000 FCFA", "−420 000 FCFA", bare at zero. */
const signed = (minor: number, currency: string) => formatMoney(minor, { currency, sign: { context: "net" } });

function totalText(minor: number, currency: string): string {
  return minor < 0 ? profitOrLoss(minor, { currency }).text : formatMoney(minor, { currency });
}

/** The phone's bridge, and the chart's table view: one row per bar, adding up to the last. */
function BridgeList({ labelled, currency }: { labelled: Labelled[]; currency: string }) {
  return (
    <dl data-slot="profit-bridge-list" className="flex flex-col">
      {labelled.map(({ step, label }) => (
        <div
          key={step.key}
          data-slot="profit-bridge-row"
          data-kind={step.kind}
          className={cn(
            "flex items-baseline justify-between gap-3 border-b py-2 text-sm last:border-b-0",
            step.kind === "total" && "font-semibold",
          )}
        >
          <dt className="min-w-0">{label}</dt>
          <dd className="m-0 shrink-0 tabular-nums">
            {step.kind === "total" ? totalText(step.value, currency) : signed(step.value, currency)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BridgeChart({ labelled, currency }: { labelled: Labelled[]; currency: string }) {
  const { t } = useTranslation();
  const data = labelled.map(({ step, label }) => ({
    key: step.key,
    label,
    // A floating bar from where the running total stood to where it ends.
    range: [Math.min(step.from, step.to), Math.max(step.from, step.to)] as [number, number],
    step,
  }));
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-[300px] w-full">
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tickMargin={6} height={40} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => formatCompact(value)} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          content={({ active, payload }) => {
            const step = (payload?.[0]?.payload as { step?: BridgeStep; label?: string } | undefined)?.step;
            const label = (payload?.[0]?.payload as { label?: string } | undefined)?.label;
            if (active !== true || step === undefined) return null;
            return (
              <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <p className="font-medium">{label}</p>
                <p className="flex justify-between gap-4 tabular-nums">
                  <span className="text-muted-foreground">
                    {step.kind === "total"
                      ? t(step.value < 0 ? "common.loss" : "common.profit")
                      : t(step.value >= 0 ? "dashboard.bridge.raised" : "dashboard.bridge.lowered")}
                  </span>
                  <span className="font-medium">
                    {step.kind === "total"
                      ? formatMoney(Math.abs(step.value), { currency })
                      : signed(step.value, currency)}
                  </span>
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="range" radius={4} isAnimationActive={false}>
          {data.map((point) => (
            <Cell
              key={point.key}
              fill={
                point.step.kind === "total"
                  ? "var(--foreground)"
                  : point.step.value >= 0
                    ? "var(--series-1)"
                    : "var(--series-2)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
