import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export interface ProfitBarRow {
  key: string;
  label: string;
  /** Signed: below zero is a loss. */
  value: number;
  /** One short line under the label ("3 trips · 1 200 km"). */
  detail?: ReactNode;
  /** Where the row's label leads (the truck's own page). */
  to?: string;
}

/**
 * Which earn, which lose? (dashboards.html, ProfitBars): one signed bar per
 * row from a shared zero line, losses to the left in the destructive tone,
 * profits to the right. Losses come first, so the rows that need someone are
 * never the ones folded away. The figure is written on every row in words
 * (`format`), so the colour is never alone and the list is its own table.
 */
export function ProfitBars({
  rows,
  format,
  maxRows = 8,
  moreLabel,
  className,
}: {
  rows: readonly ProfitBarRow[];
  format: (value: number) => string;
  maxRows?: number;
  /** Says how many rows were left out ("4 more trucks"); shown only when some were. */
  moreLabel?: (count: number) => ReactNode;
  className?: string;
}) {
  const sorted = [...rows].sort((a, b) => a.value - b.value || a.label.localeCompare(b.label));
  const shown = sorted.slice(0, maxRows);
  const hidden = sorted.length - shown.length;
  const scale = Math.max(1, ...shown.map((row) => Math.abs(row.value)));
  const hasLoss = shown.some((row) => row.value < 0);
  // Without a loss the zero line sits at the left edge and every bar runs right.
  const zero = hasLoss ? 50 : 0;
  const span = hasLoss ? 50 : 100;

  return (
    <div data-slot="profit-bars" className={cn("flex flex-col gap-3", className)}>
      <ul className="flex flex-col gap-3">
        {shown.map((row) => {
          const width = (Math.abs(row.value) / scale) * span;
          return (
            // The row is 44 px (py-1 eaten by -my-1, so the spacing stays) and
            // the truck link's ::after covers it: a phone-sized target.
            <li
              key={row.key}
              data-slot="profit-bars-row"
              data-loss={row.value < 0 ? "" : undefined}
              className="relative -my-1 flex flex-col gap-1.5 py-1"
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {row.to === undefined ? (
                    <span className="font-medium">{row.label}</span>
                  ) : (
                    <Link
                      to={row.to}
                      className="font-medium underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                    >
                      {row.label}
                    </Link>
                  )}
                  {row.detail !== undefined && (
                    <span className="ms-2 text-xs text-muted-foreground">{row.detail}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-right font-semibold tabular-nums",
                    row.value < 0 && "text-destructive",
                  )}
                >
                  {format(row.value)}
                </span>
              </div>
              <div className="relative h-2.5" aria-hidden>
                {hasLoss && <div className="absolute -inset-y-1 left-1/2 w-px bg-border" />}
                <div
                  className={cn(
                    "absolute inset-y-0 rounded-[3px]",
                    row.value < 0 ? "bg-destructive/70" : "bg-chart-2",
                  )}
                  style={
                    row.value < 0
                      ? { left: `${zero - width}%`, width: `${width}%` }
                      : { left: `${zero}%`, width: `${width}%` }
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && moreLabel !== undefined && (
        <p className="text-xs text-muted-foreground">{moreLabel(hidden)}</p>
      )}
    </div>
  );
}
