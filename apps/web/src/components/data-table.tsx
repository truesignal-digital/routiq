import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const DESKTOP_MEDIA_QUERY = "(min-width: 640px)";

export type DataTableMobileVisibility = "primary" | "secondary" | "hidden";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    mobile: DataTableMobileVisibility;
  }
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
  loadMore?: {
    hasNextPage: boolean;
    isFetching: boolean;
    onLoadMore: () => void;
  };
  emptyState?: ReactNode;
}

export function DataTable<TData>({
  columns,
  data,
  onRowClick,
  loadMore,
  emptyState,
}: DataTableProps<TData>) {
  const isDesktop = useDesktopMediaQuery();
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (data.length === 0) {
    return emptyState ?? null;
  }

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      {isDesktop ? (
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(onRowClick && "cursor-pointer")}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => handleRowKeyDown(event, row, onRowClick)
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const primaryCells = row
              .getVisibleCells()
              .filter((cell) => cell.column.columnDef.meta?.mobile === "primary");
            const secondaryCells = row
              .getVisibleCells()
              .filter((cell) => cell.column.columnDef.meta?.mobile === "secondary");

            return (
              <div
                key={row.id}
                className={cn(
                  "rounded-xl border border-border bg-card p-4",
                  onRowClick && "cursor-pointer hover:bg-accent",
                )}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => handleRowKeyDown(event, row, onRowClick)
                    : undefined
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {primaryCells.map((cell) => (
                    <div key={cell.id} className="font-medium">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
                {secondaryCells.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
                    {secondaryCells.map((cell, index) => (
                      <span key={cell.id}>
                        {index > 0 && <span aria-hidden> · </span>}
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loadMore?.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          onClick={loadMore.onLoadMore}
          disabled={loadMore.isFetching}
        >
          {loadMore.isFetching ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

function handleRowKeyDown<TData>(
  event: KeyboardEvent<HTMLElement>,
  row: Row<TData>,
  onRowClick: (row: TData) => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onRowClick(row.original);
  }
}

function useDesktopMediaQuery() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return true;
    }

    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);

    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isDesktop;
}
