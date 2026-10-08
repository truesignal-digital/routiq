import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type Column,
  type ColumnDef,
  type ColumnMeta,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { LIST_LIMIT_DEFAULT } from "@routiq/contracts";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  MoreHorizontal,
  SlidersHorizontal,
  type LucideIcon,
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
  DropdownMenuItem,
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
const ACTIONS_COLUMN_ID = "__actions";
const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const NO_FILTERS: DataTableFilter[] = [];
const NO_FILTER_VALUES: DataTableFilterValues = {};

/**
 * Where a column lands in a phone list row. Line 1: `title` left (the primary
 * column, the only tap target), `value` right in tabular figures. Line 2:
 * `meta` joined by " · ", `status` under the value. `hidden` stays off the
 * phone. One row anatomy for every list, so screens cannot drift into cards.
 */
export type DataTablePhoneRole = "title" | "meta" | "value" | "status" | "hidden";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    phone: DataTablePhoneRole;
    /**
     * Plain text for the phone row, for a cell laid out for the desktop table
     * (stacked lines, links). `null` or `""` leaves the slot out, separator
     * included.
     */
    phoneText?: (row: TData) => string | null;
    /** Already-localized display name, used by the column visibility menu. */
    label?: string;
  }
}

/**
 * A column `DataTable` accepts. TanStack leaves `meta` optional; here it is
 * required, so a column without a phone role fails to type-check.
 */
export type DataTableColumn<TData> = ColumnDef<TData> & {
  meta: ColumnMeta<TData, unknown>;
};

export interface DataTableFilterOption {
  value: string;
  label: string;
}

export type DataTableFilter = {
  columnId: string;
  /** Every value key controlled by the filter. Defaults to `columnId`. */
  columnIds?: string[];
} & (
  | {
      type: "select";
      options: DataTableFilterOption[];
      placeholder: string;
    }
  | { type: "search"; placeholder: string }
  | {
      type: "custom";
      render: ReactNode;
    }
);

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
  /**
   * Decisions on the row, rendered last in the footer. When present they own
   * the page's one filled button, so `fullScreen` steps down to an outline.
   */
  actions?: (row: TData, drawer: { close: () => void }) => ReactNode;
}

/**
 * A row activates one way only: it either navigates the screen away or opens
 * the viewer. Offering both would leave the operator guessing which one a click
 * means. Either way the trigger is the primary cell alone — see
 * `DataTablePrimaryColumn`.
 */
type DataTableRowActivation<TData> =
  | { onRowClick?: (row: TData) => void; rowViewer?: never }
  | { rowViewer: DataTableRowViewer<TData>; onRowClick?: never };

/**
 * The one descriptive column that opens a row. It is pinned first, can never be
 * hidden — losing it would strand the row with no way in — and its cell is the
 * only click target; the rest of the row is inert so it can carry controls.
 */
export interface DataTablePrimaryColumn {
  columnId: string;
}

/** One entry in a row's ⋯ menu. Screens decide which to offer per row. */
export interface DataTableRowAction<TData> {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: (row: TData) => void;
  destructive?: boolean;
}

export interface DataTableLoadMore {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  /**
   * Rows the read returns per request, which is how wide a pager page is.
   * Defaults to the contract's list limit; pass the read's own `limit` when it
   * asks for something else, or the pages will not line up with the cursor.
   */
  pageSize?: number;
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
  columns: DataTableColumn<TData>[];
  data: TData[];
  emptyState?: ReactNode;
  getRowId?: (row: TData, index: number) => string;

  /**
   * Names the row's sole click target. A table that configures `rowViewer` or
   * `onRowClick` needs one, or nothing on the row will open anything.
   *
   * @see DataTablePrimaryColumn
   */
  primaryColumn?: DataTablePrimaryColumn;
  /** Return `[]` for a row that has nothing to offer; it then shows no menu. */
  rowActions?: (row: TData) => DataTableRowAction<TData>[];

  sorting?: SortingState;
  defaultSorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;

  /** Embeds the view menu in the table's own toolbar. */
  enableColumnVisibility?: boolean;
  /** Set both to place a `DataTableViewOptions` elsewhere on the screen. */
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;

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
    primaryColumn,
    rowActions,
    loadMore,
    pagination,
    emptyState,
    getRowId,
    sorting,
    defaultSorting,
    onSortingChange,
    enableColumnVisibility = false,
    columnVisibility,
    onColumnVisibilityChange,
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
  const [internalColumnVisibility, setInternalColumnVisibility] =
    useState<VisibilityState>({});
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
  const [paginationState, setPaginationState] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: pagination?.defaultPageSize ?? DEFAULT_PAGE_SIZE,
  }));
  const [keysetPage, setKeysetPage] = useState(0);
  // True between asking for the next cursor and its rows landing.
  const [awaitingFetch, setAwaitingFetch] = useState(false);
  // The row survives the close so the drawer can animate out with its content
  // still on screen.
  const [viewerState, setViewerState] = useState<DataTableViewerState<TData>>();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activateRow =
    onRowClick ??
    (rowViewer === undefined
      ? undefined
      : (row: TData) => setViewerState({ row, open: true }));

  const sortingState = sorting ?? internalSorting;
  const rowSelectionState = rowSelection ?? internalRowSelection;
  const columnVisibilityState = columnVisibility ?? internalColumnVisibility;

  const handleColumnVisibilityChange: OnChangeFn<VisibilityState> = (updater) => {
    const next =
      typeof updater === "function" ? updater(columnVisibilityState) : updater;
    if (columnVisibility === undefined) {
      setInternalColumnVisibility(next);
    }
    onColumnVisibilityChange?.(next);
  };

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

  const primaryColumnId = primaryColumn?.columnId;
  const hasRowActions = rowActions !== undefined;

  const tableColumns = useMemo<ColumnDef<TData>[]>(() => {
    // Pin the primary column first and take away its hide switch: it is the
    // only way into a row, so a hidden one would be a dead end.
    let dataColumns = columns;
    if (primaryColumnId !== undefined) {
      const ordered = [...columns].sort((a, b) => {
        const rank = (column: ColumnDef<TData>, index: number) =>
          columnDefId(column, index) === primaryColumnId ? 0 : 1;
        return rank(a, columns.indexOf(a)) - rank(b, columns.indexOf(b));
      });
      dataColumns = ordered.map((column, index) =>
        columnDefId(column, index) === primaryColumnId
          ? { ...column, enableHiding: false }
          : column,
      );
    }

    const actionsColumn: ColumnDef<TData>[] = hasRowActions
      ? [
          {
            id: ACTIONS_COLUMN_ID,
            enableSorting: false,
            enableHiding: false,
            meta: { phone: "hidden" },
            // The cells are rendered at the call site, which owns the row menu.
            header: () => <span className="sr-only">{t("dataTable.actions")}</span>,
          },
        ]
      : [];

    if (!enableRowSelection) {
      return [...dataColumns, ...actionsColumn];
    }

    const selectionColumn: ColumnDef<TData> = {
      id: SELECTION_COLUMN_ID,
      enableSorting: false,
      enableHiding: false,
      meta: { phone: "hidden" },
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

    return [selectionColumn, ...dataColumns, ...actionsColumn];
  }, [columns, enableRowSelection, hasRowActions, primaryColumnId, t]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting: sortingState,
      columnVisibility: columnVisibilityState,
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
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onRowSelectionChange: handleRowSelectionChange,
    ...(getRowId ? { getRowId } : {}),
  });

  const keysetPageSize = loadMore?.pageSize ?? LIST_LIMIT_DEFAULT;
  const keysetStart = keysetPage * keysetPageSize;
  const hasCachedNextPage = data.length > keysetStart + keysetPageSize;

  // The rows we asked for have landed, so step onto the page they filled. If
  // the server had nothing more, stay put rather than stranding the pager.
  useEffect(() => {
    if (!awaitingFetch) return;
    if (hasCachedNextPage) {
      setAwaitingFetch(false);
      setKeysetPage((page) => page + 1);
    } else if (loadMore?.isFetching === false && loadMore.hasNextPage === false) {
      setAwaitingFetch(false);
    }
  }, [awaitingFetch, hasCachedNextPage, loadMore?.isFetching, loadMore?.hasNextPage]);

  // Reordering or refiltering makes the current page number meaningless — the
  // rows under it are not the rows that were there before.
  const pageResetKey = JSON.stringify([sortingState, filterValues]);
  const lastPageResetKey = useRef(pageResetKey);
  useEffect(() => {
    if (lastPageResetKey.current === pageResetKey) return;
    lastPageResetKey.current = pageResetKey;
    setKeysetPage(0);
    setAwaitingFetch(false);
    setPaginationState((state) => ({ ...state, pageIndex: 0 }));
  }, [pageResetKey]);

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
      for (const columnId of filter.columnIds ?? [filter.columnId]) {
        delete next[columnId];
      }
    }
    onFilterChange?.(next);
  };

  const isFilterActive = (filter: DataTableFilter) =>
    (filter.columnIds ?? [filter.columnId]).some(
      (columnId) => (filterValues[columnId] ?? "") !== "",
    );
  const activeFilterCount = filters.filter(isFilterActive).length;
  const hasActiveFilter = activeFilterCount > 0;
  const hideableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.id !== SELECTION_COLUMN_ID && column.getCanHide());
  // Phone rows place columns by their declared role, so the view menu is a
  // desktop control.
  const showColumnVisibility =
    isDesktop && enableColumnVisibility && hideableColumns.length > 0;
  const showToolbar = filters.length > 0 || showColumnVisibility;

  const filterControls = (inSheet: boolean) =>
    filters.map((filter) =>
      filter.type === "custom" ? (
        <div key={filter.columnId}>{filter.render}</div>
      ) : filter.type === "search" ? (
        <DataTableSearchFilter
          key={filter.columnId}
          placeholder={filter.placeholder}
          value={filterValues[filter.columnId] ?? ""}
          delayMs={searchDebounceMs}
          showLabel={inSheet}
          onCommit={(value) => commitFilter(filter.columnId, value)}
        />
      ) : (
        <DataTableSelectFilter
          key={filter.columnId}
          filter={filter}
          value={filterValues[filter.columnId] ?? ""}
          resetLabel={t("dataTable.filterAll")}
          showLabel={inSheet}
          onCommit={(value) => commitFilter(filter.columnId, value)}
        />
      ),
    );

  const toolbar = !showToolbar ? null : isDesktop ? (
    <div className="flex flex-wrap items-center gap-2">
      {filterControls(false)}

      {hasActiveFilter && (
        <Button type="button" variant="ghost" size="desktop-sm" onClick={clearFilters}>
          {t("dataTable.clearFilters")}
        </Button>
      )}

      {showColumnVisibility && (
        <ColumnVisibilityMenu
          className="ml-auto"
          entries={hideableColumns.map((column) => ({
            id: column.id,
            label: columnLabel(column),
            visible: column.getIsVisible(),
          }))}
          onToggle={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
        />
      )}
    </div>
  ) : (
    <DataTablePhoneFilters
      activeCount={activeFilterCount}
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      onClear={clearFilters}
    >
      {filterControls(true)}
    </DataTablePhoneFilters>
  );

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

  const modelRows = table.getRowModel().rows;
  // Under a cursor the table holds every page fetched so far; the pager shows
  // one slice of it at a time.
  const rows = loadMore
    ? modelRows.slice(keysetStart, keysetStart + keysetPageSize)
    : modelRows;
  const selectedCount = table.getSelectedRowModel().rows.length;

  const renderCell = (
    cell: Cell<TData, unknown>,
    content: ReactNode = flexRender(cell.column.columnDef.cell, cell.getContext()),
  ) => {
    if (cell.column.id === ACTIONS_COLUMN_ID) {
      return (
        <RowActionsMenu
          actions={rowActions?.(cell.row.original) ?? []}
          row={cell.row.original}
        />
      );
    }

    if (cell.column.id !== primaryColumnId || activateRow === undefined) {
      return content;
    }

    return (
      <button
        type="button"
        className="text-left font-medium underline-offset-4 hover:underline focus-visible:underline"
        aria-haspopup={rowViewer ? "dialog" : undefined}
        onClick={() => activateRow(cell.row.original)}
      >
        {content}
      </button>
    );
  };

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
                          size="desktop-sm"
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
                // Inert by design: only the primary cell and the row's own
                // controls act, so the rest of the row can hold buttons.
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        cell.column.id === ACTIONS_COLUMN_ID ? "w-0 text-right" : undefined
                      }
                    >
                      {renderCell(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ul data-slot="data-table-list" className="flex flex-col">
          {rows.map((row) => (
            <DataTablePhoneRow
              key={row.id}
              cells={row.getVisibleCells()}
              selected={row.getIsSelected()}
              renderCell={renderCell}
              actions={
                rowActions && (
                  <RowActionsMenu
                    actions={rowActions(row.original)}
                    row={row.original}
                    // A row with nothing to offer keeps the column, so values
                    // and badges stay aligned down the list.
                    placeholder={<span aria-hidden className="size-11 shrink-0" />}
                  />
                )
              }
            />
          ))}
        </ul>
      )}

      {/* Either pager subsumes the row count — it already says where the
          operator is — so it carries the selection count itself. */}
      {pagination ? (
        <DataTableFooter
          mode={{ kind: "counted", table }}
          selectedCount={selectedCount}
          enableRowSelection={enableRowSelection}
        />
      ) : loadMore ? (
        <DataTableFooter
          mode={{
            kind: "keyset",
            page: keysetPage,
            busy: loadMore.isFetching || awaitingFetch,
            canPrevious: keysetPage > 0,
            canNext: hasCachedNextPage || loadMore.hasNextPage,
            onPrevious: () => setKeysetPage((page) => Math.max(page - 1, 0)),
            onNext: () => {
              if (hasCachedNextPage) {
                setKeysetPage((page) => page + 1);
                return;
              }
              if (loadMore.hasNextPage) {
                setAwaitingFetch(true);
                loadMore.onLoadMore();
              }
            },
          }}
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
  const { description, fullScreen, actions } = viewer;

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
                  variant={actions ? "outline" : "default"}
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
              {actions?.(state.row, { close: onClose })}
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * One phone list row: two lines, divided from its neighbours by a 1 px line, no
 * card border. Each slot takes the columns that declared its role, in column
 * order, so every list on a phone reads the same way.
 */
function DataTablePhoneRow<TData>({
  cells,
  selected,
  renderCell,
  actions,
}: {
  cells: Cell<TData, unknown>[];
  selected: boolean;
  renderCell: (cell: Cell<TData, unknown>, content?: ReactNode) => ReactNode;
  actions: ReactNode;
}) {
  const selectionCell = cells.find((cell) => cell.column.id === SELECTION_COLUMN_ID);
  const slot = (role: DataTablePhoneRole) =>
    cells.flatMap((cell) => {
      if (cell.column.id === SELECTION_COLUMN_ID || cell.column.id === ACTIONS_COLUMN_ID) {
        return [];
      }
      if (cell.column.columnDef.meta?.phone !== role) return [];
      const content = phoneContent(cell);
      return content === null ? [] : [{ cell, content }];
    });

  const title = slot("title");
  const meta = slot("meta");
  const value = slot("value");
  const status = slot("status");

  return (
    <li
      data-slot="data-table-row"
      data-state={selected ? "selected" : undefined}
      className="flex min-h-15 items-center gap-3 border-b border-border py-2 data-[state=selected]:bg-muted/50"
    >
      {selectionCell &&
        flexRender(selectionCell.column.columnDef.cell, selectionCell.getContext())}
      {/*
        The end column may take at most half of the space between the checkbox
        and the ⋯ menu, so a long status (a cancellation's reason, a month
        name) wraps there instead of squeezing the title to zero width (#300).
      */}
      <div data-slot="data-table-row-body" className="flex min-w-0 flex-1 items-center gap-3">
        <div data-slot="data-table-row-main" className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div data-slot="data-table-row-title" className="min-w-0 truncate text-sm font-semibold">
            {title.map(({ cell, content }) => (
              <span key={cell.id}>{renderCell(cell, content)}</span>
            ))}
          </div>
          {meta.length > 0 && (
            <div
              data-slot="data-table-row-meta"
              // Cells laid out for the table (flex stacks, wrapping text) still
              // read as one line here, cut with an ellipsis.
              className="min-w-0 truncate text-xs text-muted-foreground [&_*]:inline [&_*]:whitespace-nowrap"
            >
              {meta.map(({ cell, content }, index) => (
                <span key={cell.id}>
                  {index > 0 && <span aria-hidden> · </span>}
                  {content}
                </span>
              ))}
            </div>
          )}
        </div>
        {(value.length > 0 || status.length > 0) && (
          <div
            data-slot="data-table-row-end"
            className="flex max-w-1/2 min-w-0 flex-col items-end gap-1 text-right"
          >
            {value.length > 0 && (
              <div
                data-slot="data-table-row-value"
                className="text-sm font-semibold whitespace-nowrap tabular-nums"
              >
                {value.map(({ cell, content }) => (
                  <span key={cell.id}>{content}</span>
                ))}
              </div>
            )}
            {status.length > 0 && (
              <div
                data-slot="data-table-row-status"
                // Badges and buttons are one-line pills elsewhere; here they wrap
                // too, so nothing pokes out over the title. A wrapped button
                // grows from its 44 px touch target, never below it.
                className="flex max-w-full min-w-0 flex-col items-end gap-1 text-left text-xs wrap-anywhere text-muted-foreground [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-11 [&_[data-slot=button]]:py-1 [&_[data-slot=button]]:whitespace-normal"
              >
                {status.map(({ cell, content }) => (
                  <span key={cell.id}>{content}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {actions}
    </li>
  );
}

/**
 * What a cell shows in a phone row, or `null` to leave its slot out. A blank
 * accessor value counts as empty, so a missing date or counterparty drops out
 * of the meta line instead of printing "–" between two separators.
 */
function phoneContent<TData>(cell: Cell<TData, unknown>): ReactNode | null {
  const meta = cell.column.columnDef.meta;
  if (meta?.phoneText !== undefined) {
    const text = meta.phoneText(cell.row.original);
    return text === null || text === "" ? null : text;
  }
  if (cell.column.accessorFn !== undefined) {
    const value = cell.getValue();
    if (value === null || value === undefined || value === "") return null;
  }
  return flexRender(cell.column.columnDef.cell, cell.getContext());
}

/**
 * Phone filters: one "Filters (n)" button above the list, opening a bottom
 * sheet with the same controls the desktop toolbar shows, so five filters
 * never stack in front of the first row.
 */
function DataTablePhoneFilters({
  activeCount,
  open,
  onOpenChange,
  onClear,
  children,
}: {
  activeCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={() => onOpenChange(true)}>
        <SlidersHorizontal aria-hidden />
        {t("dataTable.filters", { count: activeCount })}
      </Button>
      <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("dataTable.filtersTitle")}</DrawerTitle>
          </DrawerHeader>
          <div
            data-slot="data-table-filters"
            className="flex flex-col gap-4 overflow-y-auto px-4 py-4"
          >
            {children}
          </div>
          <DrawerFooter className="flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={activeCount === 0}
              onClick={onClear}
            >
              {t("dataTable.clearFilters")}
            </Button>
            <DrawerClose render={<Button type="button" className="flex-1" />}>
              {t("dataTable.showResults")}
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * Two honest footers behind one layout. A fully-loaded table knows how many
 * pages there are and offers jumps to the ends; a cursor read knows only that
 * something may follow, so it counts up and offers one step either way
 * (ADR-0003).
 */
type DataTableFooterMode<TData> =
  | { kind: "counted"; table: TanStackTable<TData> }
  | {
      kind: "keyset";
      page: number;
      busy: boolean;
      canPrevious: boolean;
      canNext: boolean;
      onPrevious: () => void;
      onNext: () => void;
    };

function DataTableFooter<TData>({
  mode,
  selectedCount,
  enableRowSelection,
}: {
  mode: DataTableFooterMode<TData>;
  selectedCount: number;
  enableRowSelection: boolean;
}) {
  const { t } = useTranslation();
  const rowsPerPageId = useId();
  const pageSizeItems = PAGE_SIZE_OPTIONS.map((size) => ({
    value: String(size),
    label: String(size),
  }));

  const counted = mode.kind === "counted" ? mode.table : undefined;
  const position =
    counted === undefined
      ? t("dataTable.page", { page: mode.kind === "keyset" ? mode.page + 1 : 1 })
      : t("dataTable.pageOf", {
          page: counted.getState().pagination.pageIndex + 1,
          pages: Math.max(counted.getPageCount(), 1),
        });

  const canPrevious =
    counted === undefined
      ? mode.kind === "keyset" && mode.canPrevious
      : counted.getCanPreviousPage();
  const canNext =
    counted === undefined
      ? mode.kind === "keyset" && mode.canNext
      : counted.getCanNextPage();
  const busy = mode.kind === "keyset" && mode.busy;

  const goPrevious = () =>
    counted === undefined
      ? mode.kind === "keyset" && mode.onPrevious()
      : counted.previousPage();
  const goNext = () =>
    counted === undefined
      ? mode.kind === "keyset" && mode.onNext()
      : counted.nextPage();

  return (
    <div className="flex items-center justify-between gap-4">
      {enableRowSelection && (
        <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
          {t("dataTable.selectedCount", { count: selectedCount })}
        </div>
      )}

      <div className="flex w-full items-center gap-8 lg:w-fit">
        {counted !== undefined && (
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor={rowsPerPageId} className="text-sm font-medium">
              {t("dataTable.rowsPerPage")}
            </Label>
            <Select
              items={pageSizeItems}
              value={String(counted.getState().pagination.pageSize)}
              onValueChange={(value: string | null) => {
                if (value !== null) {
                  counted.setPageSize(Number(value));
                }
              }}
            >
              <SelectTrigger size="desktop-sm" className="w-20" id={rowsPerPageId}>
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
        )}

        <div className="flex w-fit items-center justify-center text-sm font-medium">
          {position}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {/* No jump to the last page under a cursor: nothing knows where it is. */}
          {counted !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="desktop-icon-sm"
              className="hidden lg:flex"
              aria-label={t("dataTable.firstPage")}
              disabled={!canPrevious}
              onClick={() => counted.setPageIndex(0)}
            >
              <ChevronsLeft aria-hidden />
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="desktop-icon-sm"
            aria-label={t("dataTable.previousPage")}
            disabled={!canPrevious || busy}
            onClick={goPrevious}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="desktop-icon-sm"
            aria-label={t("dataTable.nextPage")}
            disabled={!canNext || busy}
            onClick={goNext}
          >
            <ChevronRight aria-hidden />
          </Button>
          {counted !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="desktop-icon-sm"
              className="hidden lg:flex"
              aria-label={t("dataTable.lastPage")}
              disabled={!canNext}
              onClick={() => counted.setPageIndex(counted.getPageCount() - 1)}
            >
              <ChevronsRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function RowActionsMenu<TData>({
  actions,
  row,
  className,
  placeholder = null,
}: {
  actions: DataTableRowAction<TData>[];
  row: TData;
  className?: string;
  /** Rendered instead of the menu when the row offers no action. */
  placeholder?: ReactNode;
}) {
  const { t } = useTranslation();

  if (actions.length === 0) return placeholder;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="desktop-icon-sm"
            aria-label={t("dataTable.actions")}
            className={className}
          />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            {...(action.destructive ? { variant: "destructive" as const } : {})}
            onClick={() => action.onSelect(row)}
          >
            {action.icon && <action.icon aria-hidden />}
            <span className="min-w-0 truncate">{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ColumnVisibilityEntry {
  id: string;
  label: string;
  visible: boolean;
}

function ColumnVisibilityMenu({
  entries,
  onToggle,
  className,
}: {
  entries: ColumnVisibilityEntry[];
  onToggle: (id: string, visible: boolean) => void;
  className?: string | undefined;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="desktop-sm" className={className}>
            <SlidersHorizontal aria-hidden />
            {t("dataTable.view")}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("dataTable.columns")}</DropdownMenuLabel>
          {entries.map((entry) => (
            <DropdownMenuCheckboxItem
              key={entry.id}
              closeOnClick={false}
              checked={entry.visible}
              onCheckedChange={(checked) => onToggle(entry.id, checked)}
            >
              {entry.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** TanStack's own rule: an explicit `id`, else the accessor key. */
function columnDefId<TData>(column: ColumnDef<TData>, index: number): string {
  if (column.id !== undefined) return column.id;
  if ("accessorKey" in column && column.accessorKey !== undefined) {
    return String(column.accessorKey);
  }
  return String(index);
}

/**
 * The column-visibility control on its own, for screens that place it in a
 * toolbar of their own instead of letting `DataTable` embed it. Pair it with
 * `DataTable`'s controlled `columnVisibility` props; leave
 * `enableColumnVisibility` off so the table does not render a second one.
 */
export function DataTableViewOptions<TData>({
  columns,
  value,
  onChange,
  primaryColumn,
  className,
}: {
  columns: ColumnDef<TData>[];
  value: VisibilityState;
  onChange: (visibility: VisibilityState) => void;
  /** Pass the table's own, or the menu will offer to hide the row's way in. */
  primaryColumn?: DataTablePrimaryColumn;
  className?: string;
}) {
  const isDesktop = useDesktopMediaQuery();
  const entries = columns
    .map((column, index) => ({ column, id: columnDefId(column, index) }))
    .filter(
      ({ column, id }) =>
        column.enableHiding !== false && id !== primaryColumn?.columnId,
    )
    .map(({ column, id }) => ({
      id,
      label: column.meta?.label ?? id,
      visible: value[id] !== false,
    }));

  // Phone rows place columns by their declared role, not by this menu.
  if (!isDesktop || entries.length === 0) return null;

  return (
    <ColumnVisibilityMenu
      className={className}
      entries={entries}
      onToggle={(id, visible) => onChange({ ...value, [id]: visible })}
    />
  );
}

function DataTableSearchFilter({
  placeholder,
  value,
  delayMs,
  showLabel,
  onCommit,
}: {
  placeholder: string;
  value: string;
  delayMs: number;
  /** In the phone sheet every control carries a visible label. */
  showLabel: boolean;
  onCommit: (value: string) => void;
}) {
  const id = useId();
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

  const input = (
    <Input
      type="search"
      id={id}
      aria-label={placeholder}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      className="w-full desktop:h-8 sm:w-56"
    />
  );

  if (!showLabel) return input;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{placeholder}</Label>
      {input}
    </div>
  );
}

function DataTableSelectFilter({
  filter,
  value,
  resetLabel,
  showLabel,
  onCommit,
}: {
  filter: Extract<DataTableFilter, { type: "select" }>;
  value: string;
  resetLabel: string;
  /** In the phone sheet a picked value would otherwise lose what it filters. */
  showLabel: boolean;
  onCommit: (value: string) => void;
}) {
  const id = useId();
  const select = (
    <Select
      items={filter.options}
      value={value === "" ? null : value}
      onValueChange={(next) => onCommit(next ?? "")}
    >
      <SelectTrigger
        size="desktop-sm"
        id={id}
        aria-label={filter.placeholder}
        className="w-full sm:w-48"
      >
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

  if (!showLabel) return select;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{filter.placeholder}</Label>
      {select}
    </div>
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
