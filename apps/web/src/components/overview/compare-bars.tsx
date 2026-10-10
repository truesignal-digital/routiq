import { cn } from "@/lib/utils";

export interface CompareBarRow {
  key: string;
  label: string;
  /** This period, in the unit `format` prints. */
  value: number;
  /** The period it is compared with. */
  comparison: number;
}

/**
 * Where did it change? (dashboards.html, CompareBars): one bar per group for
 * this period, a mark where the comparison period stood, largest first. The
 * figures are written on every row, so nothing hides behind a hover and the
 * list is its own table view. Beyond `maxRows`, the smallest groups fold into
 * one row named by `otherLabel`.
 */
export function CompareBars({
  rows,
  format,
  periodLabel,
  comparisonLabel,
  comparisonText,
  otherLabel,
  maxRows = 7,
  className,
}: {
  rows: readonly CompareBarRow[];
  format: (value: number) => string;
  /** The legend's words for the bar and the mark ("October 1–10", "September 1–10"). */
  periodLabel: string;
  comparisonLabel: string;
  /** The comparison figure beside the value on each row ("vs 120 000 XAF"). */
  comparisonText: (formatted: string) => string;
  otherLabel: (count: number) => string;
  maxRows?: number;
  className?: string;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value || b.comparison - a.comparison);
  const shown: CompareBarRow[] =
    sorted.length <= maxRows
      ? sorted
      : [
          ...sorted.slice(0, maxRows - 1),
          sorted.slice(maxRows - 1).reduce<CompareBarRow>(
            (other, row) => ({
              ...other,
              value: other.value + row.value,
              comparison: other.comparison + row.comparison,
            }),
            { key: "__other", label: otherLabel(sorted.length - maxRows + 1), value: 0, comparison: 0 },
          ),
        ];
  // A cancellation can take a group below zero; its bar then starts and ends at zero.
  const scale = Math.max(1, ...shown.flatMap((row) => [row.value, row.comparison]));
  const share = (value: number) => `${(Math.max(0, value) / scale) * 100}%`;

  return (
    <div data-slot="compare-bars" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-[3px] bg-chart-2" />
          {periodLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-[3px] rounded-[1px] bg-foreground" />
          {comparisonLabel}
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {shown.map((row) => {
          const value = format(row.value);
          const comparison = format(row.comparison);
          return (
            <li key={row.key} data-slot="compare-bars-row" className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="shrink-0 text-right">
                  <span className="font-semibold tabular-nums">{value}</span>{" "}
                  <span className="text-xs text-muted-foreground tabular-nums">{comparisonText(comparison)}</span>
                </span>
              </div>
              <div className="relative h-2.5" aria-hidden>
                <div className="absolute inset-y-0 left-0 rounded-[3px] bg-chart-2" style={{ width: share(row.value) }} />
                <div
                  className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded-[1px] bg-foreground"
                  style={{ left: share(row.comparison) }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
