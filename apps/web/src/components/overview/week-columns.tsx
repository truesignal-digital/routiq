import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export interface WeekColumn {
  key: string;
  /** Under the column ("Oct 6"). */
  label: string;
  /** The whole column: every record of the week. */
  total: number;
  /** The part drawn solid (closed); the rest is drawn light (still open). */
  done: number;
  /** Says the column in words for a screen reader and the tooltip. */
  description: string;
  /** The list filtered to the week. */
  link?: { to: string; search?: Record<string, string | undefined> };
}

/**
 * Is the work growing? (dashboards.html, trips per week): one column per
 * week, oldest first, the solid part done and the light part still open. The
 * last column is the week in progress and is drawn as partial. Each column is
 * a link to the list filtered to its week; its words are its accessible name.
 */
export function WeekColumns({
  columns,
  doneLabel,
  openLabel,
  partialLast = true,
  className,
}: {
  columns: readonly WeekColumn[];
  doneLabel: string;
  openLabel: string;
  partialLast?: boolean;
  className?: string;
}) {
  const scale = Math.max(1, ...columns.map((column) => column.total));

  return (
    <div data-slot="week-columns" className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-[3px] bg-chart-2" />
          {doneLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-[3px] bg-chart-1" />
          {openLabel}
        </span>
      </div>
      <ol className="flex h-40 items-end gap-1 sm:gap-2">
        {columns.map((column, index) => {
          const partial = partialLast && index === columns.length - 1;
          const bar = (
            <span className="flex h-full w-full flex-col items-center justify-end gap-1">
              <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{column.total}</span>
              <span
                className={cn(
                  "flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]",
                  partial && "opacity-60",
                )}
                style={{ height: `${(column.total / scale) * 100}%` }}
              >
                <span className="w-full bg-chart-1" style={{ height: `${column.total === 0 ? 0 : ((column.total - column.done) / column.total) * 100}%` }} />
                <span className="w-full bg-chart-2" style={{ height: `${column.total === 0 ? 0 : (column.done / column.total) * 100}%` }} />
              </span>
            </span>
          );
          return (
            <li key={column.key} data-slot="week-column" className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
              {column.link === undefined ? (
                <span className="flex h-full w-full" title={column.description} aria-label={column.description} role="img">
                  {bar}
                </span>
              ) : (
                <Link
                  to={column.link.to}
                  {...(column.link.search === undefined ? {} : { search: column.link.search })}
                  title={column.description}
                  aria-label={column.description}
                  className="flex h-full w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {bar}
                </Link>
              )}
              <span className="w-full truncate text-center text-[10px] text-muted-foreground tabular-nums sm:text-[11px]">
                {column.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
