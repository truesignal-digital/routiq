import { useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ChartViewToggle } from "./chart-view-toggle.js";

export interface MonthColumn {
  key: string;
  /** Under the column ("Oct"). */
  label: string;
  /** The month in full, for the table view ("October 2026"). */
  month: string;
  value: number;
  /** The figure as the column writes it above itself. */
  valueText: string;
  /**
   * The column in words, for a screen reader and the hover; a partial month
   * says so ("October (so far): 4 truck-days").
   */
  description: string;
  /** Counted to today: drawn lighter, with a dashed edge. */
  partial?: boolean;
}

/**
 * Is it getting longer? (dashboards.html#maintenance, days off the road per
 * month): one column per month, oldest first, its figure above it. A partial
 * month is drawn lighter with a dashed edge and says so in its words. Its
 * table view lists the months newest first.
 */
export function MonthColumns({
  columns,
  monthHeader,
  valueHeader,
  className,
}: {
  columns: readonly MonthColumn[];
  /** The table view's column names. */
  monthHeader: string;
  valueHeader: string;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"chart" | "table">("chart");
  const scale = Math.max(1, ...columns.map((column) => column.value));

  return (
    <div data-slot="month-columns" className={cn("flex flex-col gap-2", className)}>
      {!isMobile && view === "table" ? (
        <MonthTable columns={columns} monthHeader={monthHeader} valueHeader={valueHeader} />
      ) : (
        <ol className="flex h-40 items-end gap-1 sm:gap-2">
          {columns.map((column, index) => (
            <li key={column.key} data-slot="month-column" data-partial={column.partial ? "" : undefined} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
              <span role="img" aria-label={column.description} title={column.description} className="flex h-full w-full flex-col items-center justify-end gap-1">
                <span aria-hidden className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {column.valueText}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "w-full rounded-t-[3px]",
                    column.partial ? "border border-b-0 border-dashed border-chart-3 bg-chart-2/40" : "bg-chart-2",
                  )}
                  style={{ height: `${(column.value / scale) * 100}%` }}
                />
              </span>
              <span
                aria-hidden
                className={cn(
                  "w-full text-center text-[10px] whitespace-nowrap text-muted-foreground tabular-nums sm:truncate sm:text-[11px]",
                  // A phone has room for every third label, counted back from this month.
                  (columns.length - 1 - index) % 3 !== 0 && "max-sm:invisible",
                )}
              >
                {column.label}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!isMobile && <ChartViewToggle view={view} onChange={setView} />}
    </div>
  );
}

function MonthTable({
  columns,
  monthHeader,
  valueHeader,
}: {
  columns: readonly MonthColumn[];
  monthHeader: string;
  valueHeader: string;
}) {
  const tableColumns: DataTableColumn<MonthColumn>[] = [
    {
      id: "month",
      header: monthHeader,
      meta: { phone: "title", label: monthHeader },
      cell: ({ row }) => row.original.month,
    },
    {
      id: "value",
      header: valueHeader,
      meta: { phone: "value", label: valueHeader, phoneText: (row) => row.valueText },
      cell: ({ row }) => <span className="tabular-nums">{row.original.valueText}</span>,
    },
  ];
  return <DataTable columns={tableColumns} data={[...columns].reverse()} getRowId={(row) => row.key} showRowCount={false} />;
}
