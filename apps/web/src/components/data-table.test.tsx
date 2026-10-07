// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableColumn,
  type DataTableFilter,
} from "./data-table.js";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "dataTable.page": "Page {page}",
        "dataTable.actions": "Actions",
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
        "dataTable.filters": "Filters ({count})",
        "dataTable.filtersTitle": "Filters",
        "dataTable.showResults": "Show results",
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

const columns: DataTableColumn<Person>[] = [
  {
    accessorKey: "name",
    header: "Name",
    meta: { phone: "title" },
  },
  {
    accessorKey: "email",
    header: "Email",
    meta: { phone: "meta" },
  },
  {
    accessorKey: "internalId",
    header: "Internal ID",
    meta: { phone: "hidden" },
  },
];

const sortableColumns: DataTableColumn<Person>[] = [
  { ...columns[0]!, enableSorting: true },
  ...columns.slice(1),
];

const labelledColumns: DataTableColumn<Person>[] = columns.map((column, index) => ({
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

/** The text of each phone-row slot of one kind, in render order. */
function slotText(
  root: HTMLElement,
  slot: "title" | "meta" | "value" | "status",
): string[] {
  return [
    ...root.querySelectorAll(`[data-slot="data-table-row-${slot}"]`),
  ].map((element) => element.textContent ?? "");
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

  it("asks for the next cursor from the pager, not a load-more button", async () => {
    const onLoadMore = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={data}
        loadMore={{ hasNextPage: true, isFetching: false, onLoadMore, pageSize: 2 }}
      />,
    );

    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
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

  it("renders title and meta fields as a phone list row", () => {
    mockDesktop(false);
    const { container } = render(<DataTable columns={columns} data={[data[0]!]} />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(slotText(container, "title")).toEqual(["Ada Lovelace"]);
    expect(slotText(container, "meta")).toEqual(["ada@example.com"]);
    expect(screen.queryByText("person-1")).toBeNull();
  });

  describe("phone list rows", () => {
    type Entry = {
      entryNumber: string;
      date: string | null;
      vehicle: string | null;
      amount: string;
      status: string;
      note: string;
    };

    const entryColumns: DataTableColumn<Entry>[] = [
      { accessorKey: "status", header: "Status", meta: { phone: "status" } },
      { accessorKey: "amount", header: "Amount", meta: { phone: "value" } },
      { accessorKey: "vehicle", header: "Vehicle", meta: { phone: "meta" } },
      { accessorKey: "entryNumber", header: "Entry", meta: { phone: "title" } },
      {
        accessorKey: "date",
        header: "Date",
        meta: { phone: "meta" },
        // The desktop table prints a dash for a missing date.
        cell: ({ row }) => row.original.date ?? "–",
      },
      { accessorKey: "note", header: "Note", meta: { phone: "hidden" } },
    ];

    const entries: Entry[] = [
      {
        entryNumber: "#14",
        date: "3 Oct",
        vehicle: "VH003",
        amount: "150 000",
        status: "Waiting",
        note: "brake pads",
      },
      {
        entryNumber: "#11",
        date: null,
        vehicle: "VH001",
        amount: "135 000",
        status: "Reversed",
        note: "fuel",
      },
    ];

    function phoneRows(container: HTMLElement) {
      return [...container.querySelectorAll<HTMLElement>('[data-slot="data-table-row"]')];
    }

    it("puts title, value, meta and status in their fixed slots", () => {
      mockDesktop(false);
      const { container } = render(<DataTable columns={entryColumns} data={entries} />);

      const [first] = phoneRows(container);
      expect(slotText(first!, "title")).toEqual(["#14"]);
      expect(slotText(first!, "value")).toEqual(["150 000"]);
      expect(slotText(first!, "meta")).toEqual(["VH003 · 3 Oct"]);
      expect(slotText(first!, "status")).toEqual(["Waiting"]);
      expect(first!.textContent).not.toContain("brake pads");
    });

    it("leaves an empty meta value out with its separator", () => {
      mockDesktop(false);
      const { container } = render(<DataTable columns={entryColumns} data={entries} />);

      const second = phoneRows(container)[1]!;
      expect(slotText(second, "meta")).toEqual(["VH001"]);
      expect(second.textContent).not.toContain("·");
      expect(second.textContent).not.toContain("–");
    });

    it("lets a column swap its desktop cell for plain phone text", () => {
      mockDesktop(false);
      const withText: DataTableColumn<Entry>[] = entryColumns.map((column) =>
        column.header === "Vehicle"
          ? {
              ...column,
              meta: { phone: "meta", phoneText: (entry) => `Truck ${entry.vehicle ?? ""}` },
            }
          : column,
      );
      const { container } = render(<DataTable columns={withText} data={[entries[0]!]} />);

      expect(slotText(container, "meta")).toEqual(["Truck VH003 · 3 Oct"]);
    });

    it("divides rows with a line instead of boxing them as cards", () => {
      mockDesktop(false);
      const { container } = render(<DataTable columns={entryColumns} data={entries} />);

      for (const row of phoneRows(container)) {
        expect(row.className).toContain("min-h-15");
        expect(row.className).toContain("border-b");
        expect(row.className).not.toContain("rounded");
        expect(row.className).not.toContain("bg-card");
      }
    });

    it("keeps the title the only way into the row", async () => {
      mockDesktop(false);
      const onRowClick = vi.fn();
      const { container } = render(
        <DataTable
          columns={entryColumns}
          data={entries}
          primaryColumn={{ columnId: "entryNumber" }}
          onRowClick={onRowClick}
        />,
      );

      const first = phoneRows(container)[0]!;
      const buttons = within(first).getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual(["#14"]);
      await userEvent.click(buttons[0]!);
      expect(onRowClick).toHaveBeenCalledExactlyOnceWith(entries[0]);
    });

    it("ends the row with a 44 px ⋯ menu", () => {
      mockDesktop(false);
      const { container } = render(
        <DataTable
          columns={entryColumns}
          data={entries}
          rowActions={() => [{ key: "open", label: "Open", onSelect: vi.fn() }]}
        />,
      );

      const first = phoneRows(container)[0]!;
      const menu = within(first).getByRole("button", { name: "Actions" });
      expect(first.lastElementChild).toBe(menu);
      expect(menu.className).toContain("size-11");
    });

    it("pages a keyset read in the phone layout", async () => {
      mockDesktop(false);
      const onLoadMore = vi.fn();
      const { container } = render(
        <DataTable
          columns={entryColumns}
          data={entries}
          loadMore={{ hasNextPage: true, isFetching: false, onLoadMore, pageSize: 1 }}
        />,
      );

      expect(phoneRows(container)).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
      expect(slotText(phoneRows(container)[0]!, "title")).toEqual(["#11"]);
      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it("pages fully loaded data in the phone layout", async () => {
      mockDesktop(false);
      const { container } = render(
        <DataTable columns={entryColumns} data={entries} pagination={{ defaultPageSize: 1 }} />,
      );

      expect(screen.getByText("Page 1 of 2")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
      expect(screen.getByText("Page 2 of 2")).toBeTruthy();
      expect(slotText(phoneRows(container)[0]!, "title")).toEqual(["#11"]);
    });
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

    it("drives the table from a view menu the screen placed itself", async () => {
      function Screen() {
        const [visibility, setVisibility] = useState<VisibilityState>({});
        return (
          <>
            <DataTableViewOptions
              columns={labelledColumns}
              value={visibility}
              onChange={setVisibility}
            />
            <DataTable
              columns={labelledColumns}
              data={data}
              columnVisibility={visibility}
              onColumnVisibilityChange={setVisibility}
            />
          </>
        );
      }

      render(<Screen />);
      expect(screen.getByRole("columnheader", { name: "Email" })).toBeTruthy();

      // Proves the standalone control resolves the same column ids the table does.
      await userEvent.click(screen.getByRole("button", { name: "View" }));
      await userEvent.click(
        await screen.findByRole("menuitemcheckbox", { name: "Email address" }),
      );

      expect(screen.queryByRole("columnheader", { name: "Email" })).toBeNull();
      expect(screen.queryByText("ada@example.com")).toBeNull();
      expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    });

    it("renders only one view menu when the table embeds its own", () => {
      render(
        <DataTable columns={labelledColumns} data={data} enableColumnVisibility />,
      );

      expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(1);
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

    it("keeps selection keystrokes clear of the primary trigger", async () => {
      const onRowClick = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          enableRowSelection
          primaryColumn={{ columnId: "name" }}
          onRowClick={onRowClick}
        />,
      );

      const firstCheckbox = screen.getAllByRole("checkbox", { name: "Select row" })[0]!;
      firstCheckbox.focus();
      await userEvent.keyboard(" ");
      expect(onRowClick).not.toHaveBeenCalled();

      // The primary cell is a real button, so Enter on it opens the row.
      screen.getByRole("button", { name: "Ada Lovelace" }).focus();
      await userEvent.keyboard("{Enter}");
      expect(onRowClick).toHaveBeenCalledExactlyOnceWith(data[0]);
    });

    it("starts the phone row with the selection control", async () => {
      mockDesktop(false);
      const onRowSelectionChange = vi.fn();
      const { container } = render(
        <DataTable
          columns={columns}
          data={[data[0]!]}
          enableRowSelection
          onRowSelectionChange={onRowSelectionChange}
        />,
      );

      expect(screen.queryByRole("table")).toBeNull();
      const row = container.querySelector<HTMLElement>('[data-slot="data-table-row"]')!;
      const checkbox = within(row).getByRole("checkbox", { name: "Select row" });
      expect(row.firstElementChild?.contains(checkbox)).toBe(true);
      expect(slotText(container, "title")).toEqual(["Ada Lovelace"]);
      expect(screen.queryByText("person-1")).toBeNull();

      await userEvent.click(checkbox);
      expect(onRowSelectionChange).toHaveBeenLastCalledWith({ "0": true });
      expect(screen.getByText("1 rows selected")).toBeTruthy();
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

    it("wraps the table in the block's bordered shell", () => {
      const { container } = render(<DataTable columns={columns} data={data} />);

      const shell = container.querySelector('[data-slot="data-table-shell"]');
      expect(shell?.className).toContain("rounded-lg");
      expect(shell?.className).toContain("border");
      expect(shell?.className).toContain("overflow-hidden");
      expect(shell?.querySelector("table")).toBeTruthy();
    });

    it("leaves the phone list unwrapped", () => {
      mockDesktop(false);
      const { container } = render(<DataTable columns={columns} data={data} />);

      expect(container.querySelector("table")).toBeNull();
      expect(container.querySelector('[data-slot="data-table-shell"]')).toBeNull();
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

  });

  describe("keyset pager", () => {
    const manyPeople: Person[] = Array.from({ length: 12 }, (_, index) => ({
      name: `Person ${String(index).padStart(2, "0")}`,
      email: `person${index}@example.com`,
      internalId: `person-${index}`,
    }));

    function keyset(overrides: Partial<{
      hasNextPage: boolean;
      isFetching: boolean;
      onLoadMore: () => void;
    }> = {}) {
      return {
        hasNextPage: false,
        isFetching: false,
        onLoadMore: vi.fn(),
        pageSize: 5,
        ...overrides,
      };
    }

    it("counts up without claiming a total it cannot know", () => {
      render(
        <DataTable columns={columns} data={manyPeople} loadMore={keyset()} />,
      );

      expect(screen.getByText("Page 1")).toBeTruthy();
      expect(screen.queryByText(/of/)).toBeNull();
      // A cursor cannot jump to an end it has never seen.
      expect(screen.queryByRole("button", { name: "Go to first page" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Go to last page" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rows per page" })).toBeNull();
    });

    it("slices the cache into pages and walks back without refetching", async () => {
      const onLoadMore = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={manyPeople}
          loadMore={keyset({ onLoadMore })}
        />,
      );

      expect(renderedNames()).toHaveLength(5);
      expect(screen.getByText("Person 00")).toBeTruthy();

      // Forward into rows already cached: no fetch.
      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
      expect(screen.getByText("Page 2")).toBeTruthy();
      expect(screen.getByText("Person 05")).toBeTruthy();
      expect(screen.queryByText("Person 00")).toBeNull();
      expect(onLoadMore).not.toHaveBeenCalled();

      await userEvent.click(
        screen.getByRole("button", { name: "Go to previous page" }),
      );
      expect(screen.getByText("Page 1")).toBeTruthy();
      expect(screen.getByText("Person 00")).toBeTruthy();
      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it("fetches at the edge of the cache and steps on once the rows land", async () => {
      const onLoadMore = vi.fn();
      const firstPage = manyPeople.slice(0, 5);
      const { rerender } = render(
        <DataTable
          columns={columns}
          data={firstPage}
          loadMore={keyset({ hasNextPage: true, onLoadMore })}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
      expect(onLoadMore).toHaveBeenCalledOnce();
      // Still on page 1 — the rows for page 2 do not exist yet.
      expect(screen.getByText("Page 1")).toBeTruthy();

      rerender(
        <DataTable
          columns={columns}
          data={manyPeople.slice(0, 10)}
          loadMore={keyset({ hasNextPage: true, onLoadMore })}
        />,
      );

      await waitFor(() => expect(screen.getByText("Page 2")).toBeTruthy());
      expect(screen.getByText("Person 05")).toBeTruthy();
    });

    it("stops advancing when the server says there is nothing more", () => {
      render(
        <DataTable
          columns={columns}
          data={manyPeople.slice(0, 5)}
          loadMore={keyset()}
        />,
      );

      const next = screen.getByRole("button", { name: "Go to next page" });
      expect(next.hasAttribute("disabled")).toBe(true);
      expect(
        screen.getByRole("button", { name: "Go to previous page" }).hasAttribute("disabled"),
      ).toBe(true);
    });

    it("holds the pager still while a fetch is in flight", () => {
      render(
        <DataTable
          columns={columns}
          data={manyPeople}
          loadMore={keyset({ hasNextPage: true, isFetching: true })}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Go to next page" }).hasAttribute("disabled"),
      ).toBe(true);
    });

    it("returns to the first page when the filter changes", async () => {
      const onFilterChange = vi.fn();
      const filters: DataTableFilter[] = [
        { columnId: "status", type: "select", placeholder: "Status", options: [
          { value: "A", label: "Alpha" },
        ] },
      ];
      const { rerender } = render(
        <DataTable
          columns={columns}
          data={manyPeople}
          loadMore={keyset()}
          filters={filters}
          filterValues={{}}
          onFilterChange={onFilterChange}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
      expect(screen.getByText("Page 2")).toBeTruthy();

      // The rows behind "page 2" are not the same rows once the filter moves.
      rerender(
        <DataTable
          columns={columns}
          data={manyPeople}
          loadMore={keyset()}
          filters={filters}
          filterValues={{ status: "A" }}
          onFilterChange={onFilterChange}
        />,
      );

      await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
    });

    it("returns to the first page when the sort changes", async () => {
      const { rerender } = render(
        <DataTable
          columns={sortableColumns}
          data={manyPeople}
          loadMore={keyset()}
          sorting={[]}
          onSortingChange={vi.fn()}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
      expect(screen.getByText("Page 2")).toBeTruthy();

      rerender(
        <DataTable
          columns={sortableColumns}
          data={manyPeople}
          loadMore={keyset()}
          sorting={[{ id: "name", desc: true }]}
          onSortingChange={vi.fn()}
        />,
      );

      await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
    });
  });

  describe("row viewer drawer", () => {
    const viewer = {
      title: (person: Person) => person.name,
      description: (person: Person) => person.email,
      render: (person: Person) => <p>Internal ID {person.internalId}</p>,
    };

    const primary = { columnId: "name" } as const;

    it("opens from the primary cell with the activated row's detail", async () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          primaryColumn={primary}
          rowViewer={viewer}
        />,
      );

      expect(screen.queryByRole("dialog")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("ada@example.com")).toBeTruthy();
      expect(within(drawer).getByText("Internal ID person-1")).toBeTruthy();
    });

    it("leaves the rest of the row inert", async () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          primaryColumn={primary}
          rowViewer={viewer}
        />,
      );

      // A non-primary cell — the row body no longer opens anything, which is
      // what frees it to carry action controls.
      await userEvent.click(screen.getByText("ada@example.com"));
      expect(screen.queryByRole("dialog")).toBeNull();

      await userEvent.click(screen.getAllByRole("row")[1]!);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("announces the primary cell as opening a dialog", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          primaryColumn={primary}
          rowViewer={viewer}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Ada Lovelace" }).getAttribute("aria-haspopup"),
      ).toBe("dialog");
    });

    it("opens on keyboard activation and closes on Escape", async () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          primaryColumn={primary}
          rowViewer={viewer}
        />,
      );

      screen.getByRole("button", { name: "Grace Hopper" }).focus();
      await userEvent.keyboard("{Enter}");

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("grace@example.com")).toBeTruthy();

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("closes through the drawer's own close action", async () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          primaryColumn={primary}
          rowViewer={viewer}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));
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
          primaryColumn={primary}
          rowViewer={{
            ...viewer,
            fullScreen: { label: "Open full screen", onOpen },
          }}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));
      await screen.findByRole("dialog");
      await userEvent.click(screen.getByRole("button", { name: "Open full screen" }));

      expect(onOpen).toHaveBeenCalledExactlyOnceWith(data[0]);
    });

    it("opens from the phone row's title", async () => {
      mockDesktop(false);
      render(
        <DataTable
          columns={columns}
          data={[data[0]!]}
          primaryColumn={primary}
          rowViewer={viewer}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));

      expect(await screen.findByRole("dialog")).toBeTruthy();
    });

    it("puts the row's decisions last in the footer and lets them close the drawer", async () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          primaryColumn={primary}
          rowViewer={{
            ...viewer,
            fullScreen: { label: "Open full screen", onOpen: vi.fn() },
            actions: (person, drawer) => (
              <button type="button" onClick={drawer.close}>
                Decide on {person.name}
              </button>
            ),
          }}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));
      const drawer = await screen.findByRole("dialog");
      const footerButtons = within(drawer).getAllByRole("button");
      expect(footerButtons.at(-1)?.textContent).toBe("Decide on Ada Lovelace");
      // The decision owns the one filled button; full screen steps down.
      expect(
        within(drawer).getByRole("button", { name: "Open full screen" }).className,
      ).not.toContain("bg-primary");

      await userEvent.click(
        within(drawer).getByRole("button", { name: "Decide on Ada Lovelace" }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("navigates instead of opening when the screen chose onRowClick", async () => {
      const onRowClick = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          primaryColumn={primary}
          onRowClick={onRowClick}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));

      expect(onRowClick).toHaveBeenCalledExactlyOnceWith(data[0]);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("primary column", () => {
    it("pins itself first among the data columns", () => {
      render(
        <DataTable
          columns={labelledColumns}
          data={data}
          primaryColumn={{ columnId: "email" }}
        />,
      );

      expect(
        screen.getAllByRole("columnheader").map((header) => header.textContent),
      ).toEqual(["Email", "Name", "Internal ID"]);
    });

    it("cannot be hidden — it is the only way into a row", async () => {
      render(
        <DataTable
          columns={labelledColumns}
          data={data}
          primaryColumn={{ columnId: "name" }}
          enableColumnVisibility
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "View" }));

      const items = (await screen.findAllByRole("menuitemcheckbox")).map(
        (item) => item.textContent,
      );
      expect(items).not.toContain("Full name");
      expect(items).toContain("Email address");
    });

    it("stays plain text when no activation is configured", () => {
      render(
        <DataTable columns={columns} data={data} primaryColumn={{ columnId: "name" }} />,
      );

      expect(screen.queryByRole("button", { name: "Ada Lovelace" })).toBeNull();
      expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    });
  });

  describe("row actions", () => {
    it("fires the chosen action with its row", async () => {
      const onSelect = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          rowActions={(person) => [
            { key: "reverse", label: `Reverse ${person.name}`, onSelect },
          ]}
        />,
      );

      const menus = screen.getAllByRole("button", { name: "Actions" });
      expect(menus).toHaveLength(2);

      await userEvent.click(menus[1]!);
      await userEvent.click(
        await screen.findByRole("menuitem", { name: "Reverse Grace Hopper" }),
      );

      expect(onSelect).toHaveBeenCalledExactlyOnceWith(data[1]);
    });

    it("offers no menu for a row with nothing to do", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          rowActions={(person) =>
            person.name === "Ada Lovelace"
              ? [{ key: "edit", label: "Edit", onSelect: vi.fn() }]
              : []
          }
        />,
      );

      // Role gating is the screen's business; the table just renders what it gets.
      expect(screen.getAllByRole("button", { name: "Actions" })).toHaveLength(1);
    });

    it("keeps its column out of the view menu", async () => {
      render(
        <DataTable
          columns={labelledColumns}
          data={data}
          rowActions={() => [{ key: "edit", label: "Edit", onSelect: vi.fn() }]}
          enableColumnVisibility
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "View" }));

      const items = (await screen.findAllByRole("menuitemcheckbox")).map(
        (item) => item.textContent,
      );
      expect(items).toEqual(["Full name", "Email address", "Identifier"]);
    });

    it("keeps a long action label on one line instead of squeezing it to the ⋯ button's width", async () => {
      render(
        <DataTable
          columns={columns}
          data={[data[0]!]}
          rowActions={() => [
            { key: "reverse", label: "Contre-passer l'écriture", onSelect: vi.fn() },
          ]}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Actions" }));
      const item = await screen.findByRole("menuitem", {
        name: "Contre-passer l'écriture",
      });
      const popup = item.closest<HTMLElement>('[data-slot="dropdown-menu-content"]');

      // jsdom has no layout, so the guard pins the classes that decide wrapping.
      expect(popup?.className).not.toContain("w-(--anchor-width)");
      expect(popup?.className).toContain("w-max");
      expect(popup?.className).toContain("max-w-");
      expect(within(item).getByText("Contre-passer l'écriture").className).toContain(
        "truncate",
      );
    });

    it("puts the menu at the end of the phone row", () => {
      mockDesktop(false);
      render(
        <DataTable
          columns={columns}
          data={[data[0]!]}
          rowActions={() => [{ key: "edit", label: "Edit", onSelect: vi.fn() }]}
        />,
      );

      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByRole("button", { name: "Actions" })).toBeTruthy();
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

    describe("on a phone", () => {
      const threeFilters: DataTableFilter[] = [
        ...filters,
        {
          columnId: "team",
          type: "select",
          placeholder: "Team",
          options: [{ value: "OPS", label: "Operations" }],
        },
      ];

      it("collapses the filters into one button that counts the active ones", () => {
        mockDesktop(false);
        render(
          <DataTable
            columns={columns}
            data={data}
            filters={threeFilters}
            filterValues={{ q: "ada", status: "DRAFT" }}
            onFilterChange={vi.fn()}
          />,
        );

        expect(screen.getByRole("button", { name: "Filters (2)" })).toBeTruthy();
        // No control stacks above the first row.
        expect(screen.queryByLabelText("Search people")).toBeNull();
        expect(screen.queryByRole("combobox")).toBeNull();
      });

      it("opens a bottom sheet with the same controls and a clear action", async () => {
        mockDesktop(false);
        const onFilterChange = vi.fn();
        render(
          <DataTable
            columns={columns}
            data={data}
            filters={threeFilters}
            filterValues={{ status: "DRAFT" }}
            onFilterChange={onFilterChange}
          />,
        );

        await userEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
        const sheet = await screen.findByRole("dialog");

        expect(within(sheet).getByLabelText("Search people")).toBeTruthy();
        expect(within(sheet).getByRole("combobox", { name: "Status" })).toBeTruthy();
        expect(within(sheet).getByRole("combobox", { name: "Team" })).toBeTruthy();
        // Clear before the action that closes the sheet: submit goes last.
        const footer = within(sheet).getAllByRole("button").slice(-2);
        expect(footer.map((button) => button.textContent)).toEqual([
          "Clear filters",
          "Show results",
        ]);

        await userEvent.click(within(sheet).getByRole("button", { name: "Clear filters" }));
        expect(onFilterChange).toHaveBeenCalledExactlyOnceWith({});
      });

      it("keeps the filters button when a filter empties the list", () => {
        mockDesktop(false);
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

        expect(screen.getByRole("button", { name: "Filters (1)" })).toBeTruthy();
        expect(screen.getByText("No people found.")).toBeTruthy();
      });
    });
  });
});
