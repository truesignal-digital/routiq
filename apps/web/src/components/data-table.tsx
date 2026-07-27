import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebounce } from "@/lib/useDebounce";
import { cn } from "@/lib/utils";

const DESKTOP_MEDIA_QUERY = "(min-width: 640px)";
const SELECTION_COLUMN_ID = "__select";
const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const NO_FILTERS: DataTableFilter[] = [];
const NO_FILTER_VALUES: DataTableFilterValues = {};

export type DataTableMobileVisibility = "primary" | "secondary" | "hidden";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    mobile: DataTableMobileVisibility;
    /** Already-localized display name, used by the column visibility menu. */
    label?: string;
  }
}

export interface DataTableFilterOption {
  value: string;
  label: string;
}

export type DataTableFilter =
  | {
      columnId: string;
      type: "select";
      options: DataTableFilterOption[];
      placeholder: string;
    }
  | { columnId: string; type: "search"; placeholder: string };

/** Filter state keyed by `columnId`. An absent key means the filter is unset. */
export type DataTableFilterValues = Record<string, string>;

/** Side panel opened by activating a row, per the dashboard-01 row viewer. */
export interface DataTableRowViewer<TData> {
  /** Drawer body for the activated row. */
  render: (row: TData) => ReactNode;
  title: (row: TData) => string;
  description?: (row: TData) => string;
  /** Primary footer action, for handing the row off to its own route. */
  fullScreen?: {
    label: string;
    onOpen: (row: TData) => void;
  };
}

/**
 * A row activates one way only: it either navigates the screen away or opens
 * the viewer. Offering both would leave the operator guessing which one a click
 * means.
 */
type DataTableRowActivation<TData> =
  | { onRowClick?: (row: TData) => void; rowViewer?: never }
  | { rowViewer: DataTableRowViewer<TData>; onRowClick?: never };

export interface DataTableLoadMore {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
}

export interface DataTablePagination {
  /** Rows per page until the operator picks another size. */
  defaultPageSize?: number;
}

/**
 * The two footers are exclusive because they answer to different reads. A
 * keyset cursor never learns how many rows are behind it, so `loadMore` cannot
 * honestly print "page X of Y" (ADR-0003); only fully-loaded data gets a pager.
 */
type DataTablePaging =
  | { loadMore?: DataTableLoadMore; pagination?: never }
  | { pagination: DataTablePagination; loadMore?: never };

export type DataTableProps<TData> = DataTableBaseProps<TData> &
  DataTableRowActivation<TData> &
  DataTablePaging;

interface DataTableBaseProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  emptyState?: ReactNode;
  getRowId?: (row: TData, index: number) => string;

  sorting?: SortingState;
  defaultSorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;

  enableColumnVisibility?: boolean;

  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;

  filters?: DataTableFilter[];
  filterValues?: DataTableFilterValues;
  onFilterChange?: (values: DataTableFilterValues) => void;
  searchDebounceMs?: number;

  showRowCount?: boolean;
}

export function DataTable<TData>(props: DataTableProps<TData>) {
  const {
    columns,
    data,
    onRowClick,
    rowViewer,
    loadMore,
    pagination,
    emptyState,
    getRowId,
    sorting,
    defaultSorting,
    onSortingChange,
    enableColumnVisibility = false,
    enableRowSelection = false,
    rowSelection,
    onRowSelectionChange,
    filters = NO_FILTERS,
    filterValues = NO_FILTER_VALUES,
    onFilterChange,
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
    showRowCount = true,
  } = props;
  const { t } = useTranslation();
  const isDesktop = useDesktopMediaQuery();

  const [internalSorting, setInternalSorting] = useState<SortingState>(
    () => defaultSorting ?? [],
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
  const [paginationState, setPaginationState] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: pagination?.defaultPageSize ?? DEFAULT_PAGE_SIZE,
  }));
  // The row survives the close so the drawer can animate out with its content
  // still on screen.
  const [viewerState, setViewerState] = useState<DataTableViewerState<TData>>();

  const activateRow =
    onRowClick ??
    (rowViewer === undefined
      ? undefined
      : (row: TData) => setViewerState({ row, open: true }));

  const sortingState = sorting ?? internalSorting;
  const rowSelectionState = rowSelection ?? internalRowSelection;

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sortingState) : updater;
    if (sorting === undefined) {
      setInternalSorting(next);
    }
    onSortingChange?.(next);
  };

  const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
    const next = typeof updater === "function" ? updater(rowSelectionState) : updater;
    if (rowSelection === undefined) {
      setInternalRowSelection(next);
    }
    onRowSelectionChange?.(next);
  };

  const tableColumns = useMemo<ColumnDef<TData>[]>(() => {
    if (!enableRowSelection) {
      return columns;
    }

    const selectionColumn: ColumnDef<TData> = {
      id: SELECTION_COLUMN_ID,
      enableSorting: false,
      enableHiding: false,
      meta: { mobile: "hidden" },
      header: ({ table }) => (
        <RowActivationBoundary>
          <Checkbox
            aria-label={t("dataTable.selectAll")}
            checked={table.getIsAllRowsSelected()}
            indeterminate={
              table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()
            }
            onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
          />
        </RowActivationBoundary>
      ),
      cell: ({ row }) => (
        <RowActivationBoundary>
          <Checkbox
            aria-label={t("dataTable.selectRow")}
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(checked) => row.toggleSelected(checked)}
          />
        </RowActivationBoundary>
      ),
    };

    return [selectionColumn, ...columns];
  }, [columns, enableRowSelection, t]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting: sortingState,
      columnVisibility,
      rowSelection: rowSelectionState,
      ...(pagination ? { pagination: paginationState } : {}),
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Registering the pagination row model at all slices the rows, so it only
    // goes in when the screen asked for a pager.
    ...(pagination
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          onPaginationChange: setPaginationState,
        }
      : {}),
    // A screen that owns the sorting state sorts server-side; sorting the
    // loaded page again client-side would fight it.
    manualSorting: sorting !== undefined,
    enableRowSelection,
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: handleRowSelectionChange,
    ...(getRowId ? { getRowId } : {}),
  });

  const commitFilter = (columnId: string, value: string) => {
    const next = { ...filterValues };
    if (value === "") {
      delete next[columnId];
    } else {
      next[columnId] = value;
    }
    onFilterChange?.(next);
  };

  const clearFilters = () => {
    const next = { ...filterValues };
    for (const filter of filters) {
      delete next[filter.columnId];
    }
    onFilterChange?.(next);
  };

  const hasActiveFilter = filters.some(
    (filter) => (filterValues[filter.columnId] ?? "") !== "",
  );
  const hideableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.id !== SELECTION_COLUMN_ID && column.getCanHide());
  const showToolbar = filters.length > 0 || (enableColumnVisibility && hideableColumns.length > 0);

  const toolbar = showToolbar ? (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) =>
        filter.type === "search" ? (
          <DataTableSearchFilter
            key={filter.columnId}
            placeholder={filter.placeholder}
            value={filterValues[filter.columnId] ?? ""}
            delayMs={searchDebounceMs}
            onCommit={(value) => commitFilter(filter.columnId, value)}
          />
        ) : (
          <DataTableSelectFilter
            key={filter.columnId}
            filter={filter}
            value={filterValues[filter.columnId] ?? ""}
            resetLabel={t("dataTable.filterAll")}
            onCommit={(value) => commitFilter(filter.columnId, value)}
          />
        ),
      )}

      {hasActiveFilter && (
        <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
          {t("dataTable.clearFilters")}
        </Button>
      )}

      {enableColumnVisibility && hideableColumns.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" size="sm" className="ml-auto">
                <SlidersHorizontal aria-hidden />
                {t("dataTable.view")}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("dataTable.columns")}</DropdownMenuLabel>
              {hideableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  closeOnClick={false}
                  checked={column.getIsVisible()}
                  onCheckedChange={(checked) => column.toggleVisibility(checked)}
                >
                  {columnLabel(column)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  ) : null;

  if (data.length === 0) {
    if (toolbar === null) {
      return emptyState ?? null;
    }

    return (
      <div className="flex flex-col gap-3">
        {toolbar}
        {emptyState}
      </div>
    );
  }

  const rows = table.getRowModel().rows;
  const selectedCount = table.getSelectedRowModel().rows.length;

  return (
    <div className="flex flex-col gap-3">
      {toolbar}

      {isDesktop ? (
        <div
          data-slot="data-table-shell"
          className="overflow-hidden rounded-lg border"
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} aria-sort={ariaSort(header.column)}>
                      {header.isPlaceholder ? null : isSortable(header.column) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2.5"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <SortIndicator direction={header.column.getIsSorted()} />
                        </Button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
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
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(activateRow && "cursor-pointer")}
                  tabIndex={activateRow ? 0 : undefined}
                  aria-haspopup={rowViewer ? "dialog" : undefined}
                  onClick={activateRow ? () => activateRow(row.original) : undefined}
                  onKeyDown={
                    activateRow
                      ? (event) => handleRowKeyDown(event, row, activateRow)
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
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const visibleCells = row.getVisibleCells();
            const selectionCell = visibleCells.find(
              (cell) => cell.column.id === SELECTION_COLUMN_ID,
            );
            const primaryCells = visibleCells.filter(
              (cell) => cell.column.columnDef.meta?.mobile === "primary",
            );
            const secondaryCells = visibleCells.filter(
              (cell) => cell.column.columnDef.meta?.mobile === "secondary",
            );

            return (
              <div
                key={row.id}
                className={cn(
                  "rounded-xl border border-border bg-card p-4",
                  activateRow && "cursor-pointer hover:bg-accent",
                )}
                role={activateRow ? "button" : undefined}
                tabIndex={activateRow ? 0 : undefined}
                aria-haspopup={rowViewer ? "dialog" : undefined}
                onClick={activateRow ? () => activateRow(row.original) : undefined}
                onKeyDown={
                  activateRow
                    ? (event) => handleRowKeyDown(event, row, activateRow)
                    : undefined
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {selectionCell &&
                    flexRender(
                      selectionCell.column.columnDef.cell,
                      selectionCell.getContext(),
                    )}
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

      {/* The pager subsumes the row count — "page X of Y" already says where
          the operator is — so it carries the selection count itself. */}
      {pagination ? (
        <DataTablePager
          table={table}
          selectedCount={selectedCount}
          enableRowSelection={enableRowSelection}
        />
      ) : (
        showRowCount && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("dataTable.rowCount", { count: rows.length })}</span>
            {enableRowSelection && (
              <span>{t("dataTable.selectedCount", { count: selectedCount })}</span>
            )}
          </div>
        )
      )}

      {loadMore?.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          onClick={loadMore.onLoadMore}
          disabled={loadMore.isFetching}
        >
          {loadMore.isFetching ? t("dataTable.loading") : t("dataTable.loadMore")}
        </Button>
      )}

      {rowViewer && (
        <DataTableRowDrawer
          viewer={rowViewer}
          state={viewerState}
          isDesktop={isDesktop}
          onClose={() =>
            setViewerState((current) =>
              current === undefined ? current : { ...current, open: false },
            )
          }
        />
      )}
    </div>
  );
}

interface DataTableViewerState<TData> {
  row: TData;
  open: boolean;
}

function DataTableRowDrawer<TData>({
  viewer,
  state,
  isDesktop,
  onClose,
}: {
  viewer: DataTableRowViewer<TData>;
  state: DataTableViewerState<TData> | undefined;
  isDesktop: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { description, fullScreen } = viewer;

  return (
    <Drawer
      open={state?.open === true}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      swipeDirection={isDesktop ? "right" : "down"}
    >
      <DrawerContent>
        {state !== undefined && (
          <>
            <DrawerHeader className="gap-1">
              <DrawerTitle>{viewer.title(state.row)}</DrawerTitle>
              {description && (
                <DrawerDescription>{description(state.row)}</DrawerDescription>
              )}
            </DrawerHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 py-2 text-sm">
              {viewer.render(state.row)}
            </div>
            <DrawerFooter>
              {fullScreen && (
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => fullScreen.onOpen(state.row)}
                >
                  {fullScreen.label}
                </Button>
              )}
              <DrawerClose
                render={<Button type="button" variant="outline" className="min-h-11" />}
              >
                {t("dataTable.viewer.close")}
              </DrawerClose>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function DataTablePager<TData>({
  table,
  selectedCount,
  enableRowSelection,
}: {
  table: TanStackTable<TData>;
  selectedCount: number;
  enableRowSelection: boolean;
}) {
  const { t } = useTranslation();
  const rowsPerPageId = useId();
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = Math.max(table.getPageCount(), 1);
  const pageSizeItems = PAGE_SIZE_OPTIONS.map((size) => ({
    value: String(size),
    label: String(size),
  }));

  return (
    <div className="flex items-center justify-between gap-4">
      {enableRowSelection && (
        <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
          {t("dataTable.selectedCount", { count: selectedCount })}
        </div>
      )}

      <div className="flex w-full items-center gap-8 lg:w-fit">
        <div className="hidden items-center gap-2 lg:flex">
          <Label htmlFor={rowsPerPageId} className="text-sm font-medium">
            {t("dataTable.rowsPerPage")}
          </Label>
          <Select
            items={pageSizeItems}
            value={String(pageSize)}
            onValueChange={(value: string | null) => {
              if (value !== null) {
                table.setPageSize(Number(value));
              }
            }}
          >
            <SelectTrigger size="sm" className="w-20" id={rowsPerPageId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex w-fit items-center justify-center text-sm font-medium">
          {t("dataTable.pageOf", { page: pageIndex + 1, pages: pageCount })}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden lg:flex"
            aria-label={t("dataTable.firstPage")}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.setPageIndex(0)}
          >
            <ChevronsLeft aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("dataTable.previousPage")}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("dataTable.nextPage")}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden lg:flex"
            aria-label={t("dataTable.lastPage")}
            disabled={!table.getCanNextPage()}
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          >
            <ChevronsRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DataTableSearchFilter({
  placeholder,
  value,
  delayMs,
  onCommit,
}: {
  placeholder: string;
  value: string;
  delayMs: number;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounce(draft, delayMs);
  const committed = useRef(value);

  useEffect(() => {
    if (value === committed.current) {
      return;
    }
    committed.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (debounced === committed.current) {
      return;
    }
    committed.current = debounced;
    onCommit(debounced);
  }, [debounced, onCommit]);

  return (
    <Input
      type="search"
      aria-label={placeholder}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      className="h-9 w-full sm:w-56"
    />
  );
}

function DataTableSelectFilter({
  filter,
  value,
  resetLabel,
  onCommit,
}: {
  filter: Extract<DataTableFilter, { type: "select" }>;
  value: string;
  resetLabel: string;
  onCommit: (value: string) => void;
}) {
  return (
    <Select
      items={filter.options}
      value={value === "" ? null : value}
      onValueChange={(next) => onCommit(next ?? "")}
    >
      <SelectTrigger aria-label={filter.placeholder} className="h-9 w-full sm:w-48">
        <SelectValue placeholder={filter.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={null}>{resetLabel}</SelectItem>
        {filter.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RowActivationBoundary({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex items-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return <ArrowUp aria-hidden />;
  }
  if (direction === "desc") {
    return <ArrowDown aria-hidden />;
  }
  return <ChevronsUpDown aria-hidden className="opacity-50" />;
}

function isSortable<TData>(column: Column<TData, unknown>): boolean {
  return column.columnDef.enableSorting === true && column.getCanSort();
}

function ariaSort<TData>(
  column: Column<TData, unknown>,
): "ascending" | "descending" | "none" | undefined {
  if (!isSortable(column)) {
    return undefined;
  }
  const direction = column.getIsSorted();
  if (direction === "asc") {
    return "ascending";
  }
  if (direction === "desc") {
    return "descending";
  }
  return "none";
}

function columnLabel<TData>(column: Column<TData, unknown>): string {
  return column.columnDef.meta?.label ?? column.id;
}

function handleRowKeyDown<TData>(
  event: KeyboardEvent<HTMLElement>,
  row: Row<TData>,
  activateRow: (row: TData) => void,
) {
  const key = event.key.toLowerCase();
  if (key === "enter" || key === " ") {
    event.preventDefault();
    activateRow(row.original);
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
