// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableFilter } from "./data-table.js";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "dataTable.loading": "Loading…",
        "dataTable.loadMore": "Load more",
        "dataTable.rowCount": "{count} rows loaded",
        "dataTable.selectedCount": "{count} rows selected",
        "dataTable.selectAll": "Select all",
        "dataTable.selectRow": "Select row",
        "dataTable.view": "View",
        "dataTable.columns": "Columns",
        "dataTable.clearFilters": "Clear filters",
        "dataTable.filterAll": "All",
        "dataTable.rowsPerPage": "Rows per page",
        "dataTable.pageOf": "Page {page} of {pages}",
        "dataTable.firstPage": "Go to first page",
        "dataTable.previousPage": "Go to previous page",
        "dataTable.nextPage": "Go to next page",
        "dataTable.lastPage": "Go to last page",
        "dataTable.viewer.close": "Close",
      };
      const template = translations[key] ?? key;
      return Object.entries(options ?? {}).reduce(
        (message, [name, value]) => message.replace(`{${name}}`, String(value)),
        template,
      );
    },
    i18n: { resolvedLanguage: "en" },
  }),
}));

type Person = {
  name: string;
  email: string;
  internalId: string;
};

const columns: ColumnDef<Person>[] = [
  {
    accessorKey: "name",
    header: "Name",
    meta: { mobile: "primary" },
  },
  {
    accessorKey: "email",
    header: "Email",
    meta: { mobile: "secondary" },
  },
  {
    accessorKey: "internalId",
    header: "Internal ID",
    meta: { mobile: "hidden" },
  },
];

const sortableColumns: ColumnDef<Person>[] = [
  { ...columns[0]!, enableSorting: true },
  ...columns.slice(1),
];

const labelledColumns: ColumnDef<Person>[] = columns.map((column, index) => ({
  ...column,
  meta: { ...column.meta!, label: ["Full name", "Email address", "Identifier"][index]! },
}));

const data: Person[] = [
  {
    name: "Ada Lovelace",
    email: "ada@example.com",
    internalId: "person-1",
  },
  {
    name: "Grace Hopper",
    email: "grace@example.com",
    internalId: "person-2",
  },
];

function mockDesktop(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Body rows in render order, read through their first data cell. */
function renderedNames(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

beforeEach(() => mockDesktop(true));
afterEach(cleanup);

describe("DataTable", () => {
  it("renders rows from columns and data", () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("grace@example.com")).toBeTruthy();
  });

  it("renders localized load more button and calls onLoadMore", async () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <DataTable
        columns={columns}
        data={data}
        loadMore={{ hasNextPage: true, isFetching: false, onLoadMore }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(
      <DataTable
        columns={columns}
        data={data}
        loadMore={{ hasNextPage: false, isFetching: false, onLoadMore }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("renders the empty state when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyState={<p>No people found.</p>}
      />,
    );

    expect(screen.getByText("No people found.")).toBeTruthy();
  });

  it("renders primary and secondary fields as a mobile card", () => {
    mockDesktop(false);
    render(<DataTable columns={columns} data={[data[0]!]} />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Ada Lovelace").classList.contains("font-medium")).toBe(true);
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByText("person-1")).toBeNull();
  });

  describe("row count footer", () => {
    it("reports the loaded row count", () => {
      render(<DataTable columns={columns} data={data} />);

      expect(screen.getByText("2 rows loaded")).toBeTruthy();
      expect(screen.queryByText("0 rows selected")).toBeNull();
    });

    it("reports the selected count only when selection is enabled", async () => {
      render(<DataTable columns={columns} data={data} enableRowSelection />);

      expect(screen.getByText("0 rows selected")).toBeTruthy();

      await userEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]!);
      expect(screen.getByText("1 rows selected")).toBeTruthy();
    });

    it("can be suppressed", () => {
      render(<DataTable columns={columns} data={data} showRowCount={false} />);

      expect(screen.queryByText("2 rows loaded")).toBeNull();
    });
  });

  describe("sorting", () => {
    it("toggles order for columns that opt in", async () => {
      render(<DataTable columns={sortableColumns} data={data} />);

      const header = screen.getByRole("columnheader", { name: "Name" });
      const toggle = within(header).getByRole("button");

      await userEvent.click(toggle);
      expect(header.getAttribute("aria-sort")).toBe("ascending");
      expect(renderedNames()).toEqual(["Ada Lovelace", "Grace Hopper"]);

      await userEvent.click(toggle);
      expect(header.getAttribute("aria-sort")).toBe("descending");
      expect(renderedNames()).toEqual(["Grace Hopper", "Ada Lovelace"]);
    });

    it("leaves columns without enableSorting unsortable", () => {
      render(<DataTable columns={sortableColumns} data={data} />);

      const header = screen.getByRole("columnheader", { name: "Email" });
      expect(within(header).queryByRole("button")).toBeNull();
      expect(header.getAttribute("aria-sort")).toBeNull();
    });

    it("starts from defaultSorting when uncontrolled", () => {
      const defaultSorting: SortingState = [{ id: "name", desc: true }];
      render(
        <DataTable
          columns={sortableColumns}
          data={data}
          defaultSorting={defaultSorting}
        />,
      );

      expect(renderedNames()).toEqual(["Grace Hopper", "Ada Lovelace"]);
    });

    it("does not re-sort rows when the parent owns sorting", () => {
      render(
        <DataTable
          columns={sortableColumns}
          data={data}
          sorting={[{ id: "name", desc: true }]}
          onSortingChange={vi.fn()}
        />,
      );

      // Server-owned sorting: the rows keep the order the parent supplied.
      expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe(
        "descending",
      );
      expect(renderedNames()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    });

    it("reports sort changes to the parent when controlled", async () => {
      const onSortingChange = vi.fn();
      render(
        <DataTable
          columns={sortableColumns}
          data={data}
          sorting={[]}
          onSortingChange={onSortingChange}
        />,
      );

      const header = screen.getByRole("columnheader", { name: "Name" });
      await userEvent.click(within(header).getByRole("button"));

      expect(onSortingChange).toHaveBeenCalledExactlyOnceWith([
        { id: "name", desc: false },
      ]);
    });
  });

  describe("column visibility", () => {
    it("hides a column's header and cells through the view menu", async () => {
      render(
        <DataTable columns={labelledColumns} data={data} enableColumnVisibility />,
      );

      expect(screen.getByRole("columnheader", { name: "Email" })).toBeTruthy();

      await userEvent.click(screen.getByRole("button", { name: "View" }));
      await userEvent.click(
        await screen.findByRole("menuitemcheckbox", { name: "Email address" }),
      );

      expect(screen.queryByRole("columnheader", { name: "Email" })).toBeNull();
      expect(screen.queryByText("ada@example.com")).toBeNull();
      expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    });

    it("stays hidden unless enabled", () => {
      render(<DataTable columns={labelledColumns} data={data} />);

      expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    });
  });

  describe("row selection", () => {
    it("selects all then deselects one row without firing onRowClick", async () => {
      const onRowSelectionChange = vi.fn();
      const onRowClick = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          enableRowSelection
          onRowClick={onRowClick}
          onRowSelectionChange={onRowSelectionChange}
        />,
      );

      await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
      expect(onRowSelectionChange).toHaveBeenLastCalledWith({ "0": true, "1": true });

      await userEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[1]!);
      const lastSelection = onRowSelectionChange.mock.lastCall?.[0] as RowSelectionState;
      expect(lastSelection["0"]).toBe(true);
      expect(lastSelection["1"]).toBeFalsy();

      expect(onRowClick).not.toHaveBeenCalled();
    });

    it("keeps keyboard row activation working and swallows checkbox keystrokes", async () => {
      const onRowClick = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          enableRowSelection
          onRowClick={onRowClick}
        />,
      );

      const firstCheckbox = screen.getAllByRole("checkbox", { name: "Select row" })[0]!;
      firstCheckbox.focus();
      await userEvent.keyboard(" ");
      expect(onRowClick).not.toHaveBeenCalled();

      const firstRow = screen.getAllByRole("row")[1]!;
      firstRow.focus();
      await userEvent.keyboard("{Enter}");
      expect(onRowClick).toHaveBeenCalledExactlyOnceWith(data[0]);
    });

    it("puts the selection control in the mobile card header", () => {
      mockDesktop(false);
      render(<DataTable columns={columns} data={[data[0]!]} enableRowSelection />);

      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByRole("checkbox", { name: "Select row" })).toBeTruthy();
      expect(screen.getByText("Ada Lovelace").classList.contains("font-medium")).toBe(true);
      expect(screen.getByText("ada@example.com")).toBeTruthy();
      expect(screen.queryByText("person-1")).toBeNull();
    });
  });

  describe("dashboard-01 table chrome", () => {
    it("pins the header to the top of the scroll container", () => {
      const { container } = render(<DataTable columns={columns} data={data} />);

      const header = container.querySelector("thead");
      expect(header?.className).toContain("sticky");
      expect(header?.className).toContain("top-0");
      expect(header?.className).toContain("bg-muted");
    });
  });

  describe("pagination footer", () => {
    const manyPeople: Person[] = Array.from({ length: 12 }, (_, index) => ({
      name: `Person ${String(index).padStart(2, "0")}`,
      email: `person${index}@example.com`,
      internalId: `person-${index}`,
    }));

    it("slices the rows client-side and walks the pages", async () => {
      render(
        <DataTable
          columns={columns}
          data={manyPeople}
          pagination={{ defaultPageSize: 10 }}
        />,
      );

      expect(screen.getByText("Page 1 of 2")).toBeTruthy();
      expect(renderedNames()).toHaveLength(10);
      expect(screen.getByText("Person 00")).toBeTruthy();
      expect(screen.queryByText("Person 10")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));

      expect(screen.getByText("Page 2 of 2")).toBeTruthy();
      expect(renderedNames()).toHaveLength(2);
      expect(screen.getByText("Person 10")).toBeTruthy();
      expect(screen.queryByText("Person 00")).toBeNull();

      await userEvent.click(
        screen.getByRole("button", { name: "Go to first page" }),
      );
      expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    });

    it("disables the edges of the pager at the ends of the data", async () => {
      render(
        <DataTable
          columns={columns}
          data={manyPeople}
          pagination={{ defaultPageSize: 10 }}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Go to previous page" }).hasAttribute("disabled"),
      ).toBe(true);

      await userEvent.click(screen.getByRole("button", { name: "Go to last page" }));

      expect(
        screen.getByRole("button", { name: "Go to next page" }).hasAttribute("disabled"),
      ).toBe(true);
    });

    it("repaginates when the operator changes the page size", async () => {
      render(
        <DataTable
          columns={columns}
          data={manyPeople}
          pagination={{ defaultPageSize: 10 }}
        />,
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
      await userEvent.click(await screen.findByRole("option", { name: "20" }));

      expect(screen.getByText("Page 1 of 1")).toBeTruthy();
      expect(renderedNames()).toHaveLength(12);
    });

    it("keeps the selection count next to the pager", async () => {
      render(
        <DataTable
          columns={columns}
          data={manyPeople}
          enableRowSelection
          pagination={{ defaultPageSize: 10 }}
        />,
      );

      expect(screen.getByText("0 rows selected")).toBeTruthy();
      await userEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]!);
      expect(screen.getByText("1 rows selected")).toBeTruthy();
    });

    it("stays away from keyset reads, which have no page count to show", () => {
      render(
        <DataTable
          columns={columns}
          data={manyPeople}
          loadMore={{ hasNextPage: true, isFetching: false, onLoadMore: vi.fn() }}
        />,
      );

      expect(screen.queryByText(/^Page \d+ of/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Go to next page" })).toBeNull();
      // Nothing is sliced away either: every loaded row stays on screen.
      expect(renderedNames()).toHaveLength(12);
      expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    });
  });

  describe("row viewer drawer", () => {
    const viewer = {
      title: (person: Person) => person.name,
      description: (person: Person) => person.email,
      render: (person: Person) => <p>Internal ID {person.internalId}</p>,
    };

    it("opens on row click with the activated row's detail", async () => {
      render(<DataTable columns={columns} data={data} rowViewer={viewer} />);

      expect(screen.queryByRole("dialog")).toBeNull();

      await userEvent.click(screen.getAllByRole("row")[1]!);

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("Ada Lovelace")).toBeTruthy();
      expect(within(drawer).getByText("ada@example.com")).toBeTruthy();
      expect(within(drawer).getByText("Internal ID person-1")).toBeTruthy();
    });

    it("opens on keyboard activation and closes on Escape", async () => {
      render(<DataTable columns={columns} data={data} rowViewer={viewer} />);

      const secondRow = screen.getAllByRole("row")[2]!;
      expect(secondRow.getAttribute("aria-haspopup")).toBe("dialog");
      secondRow.focus();
      await userEvent.keyboard("{Enter}");

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("Grace Hopper")).toBeTruthy();

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("closes through the drawer's own close action", async () => {
      render(<DataTable columns={columns} data={data} rowViewer={viewer} />);

      await userEvent.click(screen.getAllByRole("row")[1]!);
      await screen.findByRole("dialog");

      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("hands the row to the full-screen action", async () => {
      const onOpen = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          rowViewer={{
            ...viewer,
            fullScreen: { label: "Open full screen", onOpen },
          }}
        />,
      );

      await userEvent.click(screen.getAllByRole("row")[1]!);
      await screen.findByRole("dialog");
      await userEvent.click(screen.getByRole("button", { name: "Open full screen" }));

      expect(onOpen).toHaveBeenCalledExactlyOnceWith(data[0]);
    });

    it("opens from a mobile card too", async () => {
      mockDesktop(false);
      render(<DataTable columns={columns} data={[data[0]!]} rowViewer={viewer} />);

      await userEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }));

      expect(await screen.findByRole("dialog")).toBeTruthy();
    });

    it("stays shut for screens that navigate instead", async () => {
      const onRowClick = vi.fn();
      render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

      await userEvent.click(screen.getAllByRole("row")[1]!);

      expect(onRowClick).toHaveBeenCalledExactlyOnceWith(data[0]);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("filter toolbar", () => {
    const filters: DataTableFilter[] = [
      { columnId: "q", type: "search", placeholder: "Search people" },
      {
        columnId: "status",
        type: "select",
        placeholder: "Status",
        options: [
          { value: "DRAFT", label: "Draft" },
          { value: "POSTED", label: "Posted" },
        ],
      },
    ];

    it("emits one debounced change for a search filter and never filters rows itself", async () => {
      const onFilterChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          filters={filters}
          filterValues={{}}
          onFilterChange={onFilterChange}
          searchDebounceMs={100}
        />,
      );

      await userEvent.type(screen.getByLabelText("Search people"), "ada");
      expect(onFilterChange).not.toHaveBeenCalled();

      await waitFor(() =>
        expect(onFilterChange).toHaveBeenLastCalledWith({ q: "ada" }),
      );
      // Three keystrokes, one emitted change.
      expect(onFilterChange).toHaveBeenCalledOnce();
      // The parent still owns the data, so both rows remain on screen.
      expect(renderedNames()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    });

    it("emits immediately for a select filter", async () => {
      const onFilterChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          filters={filters}
          filterValues={{}}
          onFilterChange={onFilterChange}
        />,
      );

      await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
      await userEvent.click(await screen.findByRole("option", { name: "Draft" }));

      expect(onFilterChange).toHaveBeenCalledExactlyOnceWith({ status: "DRAFT" });
      expect(renderedNames()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    });

    it("offers a clear action only while a filter is set", async () => {
      const onFilterChange = vi.fn();
      const { rerender } = render(
        <DataTable
          columns={columns}
          data={data}
          filters={filters}
          filterValues={{}}
          onFilterChange={onFilterChange}
        />,
      );

      expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

      rerender(
        <DataTable
          columns={columns}
          data={data}
          filters={filters}
          filterValues={{ status: "DRAFT" }}
          onFilterChange={onFilterChange}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(onFilterChange).toHaveBeenCalledExactlyOnceWith({});
    });

    it("stays reachable when a filter yields no rows", () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          filters={filters}
          filterValues={{ q: "nobody" }}
          onFilterChange={vi.fn()}
          emptyState={<p>No people found.</p>}
        />,
      );

      expect(screen.getByLabelText("Search people")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
      expect(screen.getByText("No people found.")).toBeTruthy();
    });
  });
});
