import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompact, formatMoney, localizedLabel, profitOrLoss } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";
import type { BridgeStep } from "./bridge.js";
import { ChartViewToggle } from "@/components/overview/chart-view-toggle.js";

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

/**
 * The waterfall on a wide screen, drawn in HTML rather than a chart library:
 * one axis (the zero line), a floating bar per step from where the running
 * total stood to where it ends, its short value above it, and the exact
 * amount on hover. Totals in the text colour, rises blue, falls orange.
 */
function BridgeChart({ labelled, currency }: { labelled: Labelled[]; currency: string }) {
  const { t } = useTranslation();
  const ends = labelled.flatMap(({ step }) => [step.from, step.to]);
  const low = Math.min(0, ...ends);
  const high = Math.max(0, ...ends);
  const span = Math.max(1, high - low);
  // Distance from the top of the plot, as a share of its height.
  const at = (value: number) => ((high - value) / span) * 100;
  return (
    <div data-slot="profit-bridge-chart" className="flex flex-col gap-2 pt-5">
      <div className="relative h-[240px]">
        <div aria-hidden className="absolute inset-x-0 h-px bg-border" style={{ top: `${at(0)}%` }} />
        <ol className="absolute inset-0 flex items-stretch gap-2">
          {labelled.map(({ step, label }) => {
            const top = at(Math.max(step.from, step.to));
            const height = Math.max(at(Math.min(step.from, step.to)) - top, 0.5);
            const exact =
              step.kind === "total"
                ? profitOrLoss(step.value, { currency }).text
                : `${t(step.value >= 0 ? "dashboard.bridge.raised" : "dashboard.bridge.lowered")}: ${signed(step.value, currency)}`;
            return (
              <li key={step.key} data-slot="profit-bridge-bar" data-kind={step.kind} className="relative min-w-0 flex-1">
                <Tooltip>
                  <TooltipTrigger
                    render={<div />}
                    role="img"
                    aria-label={`${label}: ${exact}`}
                    className={cn(
                      "absolute inset-x-1 rounded-[4px]",
                      step.kind === "total" ? "bg-foreground" : step.value >= 0 ? "bg-series-1" : "bg-series-2",
                    )}
                    style={{ top: `${top}%`, height: `${height}%` }}
                  />
                  <TooltipContent>
                    <span className="font-medium">{label}</span> · <span className="tabular-nums">{exact}</span>
                  </TooltipContent>
                </Tooltip>
                <span
                  aria-hidden
                  className="absolute inset-x-0 -translate-y-full pb-0.5 text-center text-[11px] text-muted-foreground tabular-nums"
                  style={{ top: `${top}%` }}
                >
                  {step.kind === "change" && step.value > 0 ? "+" : ""}
                  {formatCompact(step.value)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <ol aria-hidden className="flex gap-2">
        {labelled.map(({ step, label }) => (
          <li key={step.key} className="line-clamp-2 min-w-0 flex-1 text-center text-xs leading-tight break-words text-muted-foreground" title={label}>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
