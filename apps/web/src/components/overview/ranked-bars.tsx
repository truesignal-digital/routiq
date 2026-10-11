import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ChartViewToggle } from "./chart-view-toggle.js";

export interface RankedBarRow {
  key: string;
  label: string;
  /** In the unit `format` prints; never negative (a per-km figure, a count). */
  value: number;
  /** One short line beside the label ("3 trips"). */
  detail?: string;
  /** Where the label leads (the truck's own page). */
  to?: string;
  /** Out of line (above the threshold the caller judged): ▲ and the destructive tone. */
  flagged?: boolean;
}

/** Rows a phone shows (dashboards.html, Parts: "Top 3"). */
const PHONE_ROWS = 3;

/**
 * Which one is out of line? (dashboards.html, RankedBars with median): one
 * horizontal bar per row, largest first, in one colour, the figure written on
 * every row. An optional reference line (the fleet median) runs through every
 * bar with its label in the legend; a flagged row carries ▲ and its words, so
 * colour is never alone. Beyond `maxRows` (3 on a phone) a line says how many
 * were left out. Its table view lists every row.
 */
export function RankedBars({
  rows,
  format,
  reference,
  flagLabel,
  labelHeader,
  valueHeader,
  maxRows = 8,
  moreLabel,
  className,
}: {
  rows: readonly RankedBarRow[];
  format: (value: number) => string;
  /** The line every bar is read against ("Fleet median 290 FCFA"). */
  reference?: { value: number; label: string };
  /** Says what ▲ means, for a screen reader ("Above the fleet median"). */
  flagLabel?: string;
  /** The table view's column names. */
  labelHeader: string;
  valueHeader: string;
  maxRows?: number;
  /** "4 more trucks"; shown only when rows were left out. */
  moreLabel?: (count: number) => ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"chart" | "table">("chart");
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const limit = isMobile ? Math.min(PHONE_ROWS, maxRows) : maxRows;
  const shown = sorted.slice(0, limit);
  const hidden = sorted.length - shown.length;
  const scale = Math.max(1, reference?.value ?? 0, ...shown.map((row) => row.value));
  const share = (value: number) => `${(Math.max(0, value) / scale) * 100}%`;
  const showTable = !isMobile && view === "table";

  return (
    <div data-slot="ranked-bars" className={cn("flex flex-col gap-3", className)}>
      {showTable ? (
        <RankedTable rows={sorted} format={format} flagLabel={flagLabel} labelHeader={labelHeader} valueHeader={valueHeader} />
      ) : (
        <>
          {reference !== undefined && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-slot="ranked-bars-reference">
              <span className="inline-flex items-center gap-1.5">
                <i aria-hidden className="inline-block h-3 w-[2px] rounded-[1px] bg-foreground" />
                {reference.label}
              </span>
            </div>
          )}
          <ul className="flex flex-col gap-3">
            {shown.map((row) => (
              <li key={row.key} data-slot="ranked-bars-row" data-flagged={row.flagged ? "" : undefined} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <RowLabel row={row} />
                    {row.detail !== undefined && <span className="ms-2 text-xs text-muted-foreground">{row.detail}</span>}
                  </span>
                  <span className={cn("shrink-0 text-right font-semibold tabular-nums", row.flagged && "text-destructive")}>
                    <FlagMark flagged={row.flagged} label={flagLabel} />
                    {format(row.value)}
                  </span>
                </div>
                <div className="relative h-2.5" aria-hidden>
                  <div
                    className={cn("absolute inset-y-0 left-0 rounded-[3px]", row.flagged ? "bg-destructive/70" : "bg-series-1")}
                    style={{ width: share(row.value) }}
                  />
                  {reference !== undefined && (
                    <div
                      className="absolute -inset-y-1 w-[2px] -translate-x-1/2 rounded-[1px] bg-foreground"
                      style={{ left: share(reference.value) }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hidden > 0 && moreLabel !== undefined && <p className="text-xs text-muted-foreground">{moreLabel(hidden)}</p>}
        </>
      )}
      {!isMobile && <ChartViewToggle view={view} onChange={setView} />}
    </div>
  );
}

/** ▲ for the eye and the flag's words for a screen reader: colour is never alone. */
function FlagMark({ flagged, label }: { flagged: boolean | undefined; label: string | undefined }) {
  if (flagged !== true) return null;
  return (
    <>
      <span aria-hidden>▲ </span>
      {label !== undefined && <span className="sr-only">{label}: </span>}
    </>
  );
}

function RowLabel({ row }: { row: RankedBarRow }) {
  return row.to === undefined ? (
    <span className="font-medium">{row.label}</span>
  ) : (
    <Link to={row.to} className="font-medium underline-offset-4 hover:underline">
      {row.label}
    </Link>
  );
}

/** The chart's table view: every row, the same order and words. */
function RankedTable({
  rows,
  format,
  flagLabel,
  labelHeader,
  valueHeader,
}: {
  rows: readonly RankedBarRow[];
  format: (value: number) => string;
  flagLabel: string | undefined;
  labelHeader: string;
  valueHeader: string;
}) {
  const columns: DataTableColumn<RankedBarRow>[] = [
    {
      id: "label",
      header: labelHeader,
      meta: { phone: "title", label: labelHeader },
      cell: ({ row }) => (
        <span>
          <RowLabel row={row.original} />
          {row.original.detail !== undefined && (
            <span className="ms-2 text-xs text-muted-foreground">{row.original.detail}</span>
          )}
        </span>
      ),
    },
    {
      id: "value",
      header: valueHeader,
      meta: { phone: "value", label: valueHeader, phoneText: (row) => format(row.value) },
      cell: ({ row }) => (
        <span className={cn("tabular-nums", row.original.flagged && "font-semibold text-destructive")}>
          <FlagMark flagged={row.original.flagged} label={flagLabel} />
          {format(row.original.value)}
        </span>
      ),
    },
  ];
  return <DataTable columns={columns} data={[...rows]} getRowId={(row) => row.key} showRowCount={false} />;
}
