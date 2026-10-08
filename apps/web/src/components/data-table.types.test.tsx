// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type DataTableColumn } from "./data-table.js";

/**
 * Compile-time coverage: `tsc --noEmit` runs over this file, so a
 * `@ts-expect-error` that stops erroring fails `pnpm typecheck`. Nothing here
 * renders — the assertions are the annotations.
 */

type Person = { name: string };

const columns: DataTableColumn<Person>[] = [
  { accessorKey: "name", header: "Name", meta: { phone: "title" } },
];
const data: Person[] = [{ name: "Ada Lovelace" }];

const viewer = {
  title: (person: Person) => person.name,
  render: (person: Person) => person.name,
};

const loadMore = { hasNextPage: false, isFetching: false, onLoadMore: vi.fn() };

describe("DataTable phone roles", () => {
  it("requires every column to declare where it sits on a phone", () => {
    // @ts-expect-error a column without `meta` has no phone role
    const bare: DataTableColumn<Person>[] = [{ accessorKey: "name", header: "Name" }];
    const unlabelled: DataTableColumn<Person>[] = [
      // @ts-expect-error `meta` without `phone` is not enough
      { accessorKey: "name", header: "Name", meta: { label: "Name" } },
    ];
    const retired: DataTableColumn<Person>[] = [
      // @ts-expect-error the old card visibility is gone; phone roles replaced it
      { accessorKey: "name", header: "Name", meta: { mobile: "primary" } },
    ];

    expect([bare, unlabelled, retired]).toHaveLength(3);
  });

  it("rejects a role outside the row anatomy", () => {
    const columns: DataTableColumn<Person>[] = [
      // @ts-expect-error a phone row has title, meta, value and status slots only
      { accessorKey: "name", header: "Name", meta: { phone: "secondary" } },
    ];

    expect(columns).toHaveLength(1);
  });

  it("refuses plain TanStack columns, whose meta is optional", () => {
    const plain: ColumnDef<Person>[] = [{ accessorKey: "name", header: "Name" }];
    // @ts-expect-error DataTable only takes columns with a phone role
    const table = <DataTable columns={plain} data={data} />;

    expect(table).toBeTruthy();
  });
});

describe("DataTable prop exclusivity", () => {
  it("accepts either row activation on its own", () => {
    const navigating = <DataTable columns={columns} data={data} onRowClick={vi.fn()} />;
    const viewing = <DataTable columns={columns} data={data} rowViewer={viewer} />;

    expect([navigating, viewing]).toHaveLength(2);
  });

  it("rejects a row that both navigates and opens the viewer", () => {
    const both = (
      // @ts-expect-error a row activates one way only
      <DataTable columns={columns} data={data} onRowClick={vi.fn()} rowViewer={viewer} />
    );

    expect(both).toBeTruthy();
  });

  it("accepts either footer on its own", () => {
    const keyset = <DataTable columns={columns} data={data} loadMore={loadMore} />;
    const paged = <DataTable columns={columns} data={data} pagination={{}} />;

    expect([keyset, paged]).toHaveLength(2);
  });

  it("rejects a pager bolted onto a keyset read", () => {
    const both = (
      // @ts-expect-error keyset reads have no page count to paginate over
      <DataTable columns={columns} data={data} loadMore={loadMore} pagination={{}} />
    );

    expect(both).toBeTruthy();
  });

  it("takes a primary column and row actions alongside either activation", () => {
    const configured = (
      <DataTable
        columns={columns}
        data={data}
        primaryColumn={{ columnId: "name" }}
        rowActions={(person) => [
          { key: "open", label: person.name, onSelect: vi.fn(), destructive: true },
        ]}
        rowViewer={viewer}
      />
    );

    expect(configured).toBeTruthy();
  });

  it("types a row action's onSelect to the table's own row", () => {
    // The generic is pinned so a wrong handler blames itself rather than
    // re-inferring TData from the mistake.
    const typed = (
      <DataTable<Person>
        columns={columns}
        data={data}
        // @ts-expect-error the action receives a Person, not a string
        rowActions={() => [
          { key: "open", label: "Open", onSelect: (row: string) => row.trim() },
        ]}
      />
    );

    expect(typed).toBeTruthy();
  });

  it("keeps the keyset page size a number", () => {
    const sized = (
      <DataTable
        columns={columns}
        data={data}
        // @ts-expect-error the page size mirrors the read's numeric limit
        loadMore={{ ...loadMore, pageSize: "50" }}
      />
    );

    expect(sized).toBeTruthy();
  });
});
