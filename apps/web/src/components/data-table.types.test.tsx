// @vitest-environment jsdom
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table.js";

/**
 * Compile-time coverage: `tsc --noEmit` runs over this file, so a
 * `@ts-expect-error` that stops erroring fails `pnpm typecheck`. Nothing here
 * renders — the assertions are the annotations.
 */

type Person = { name: string };

const columns: ColumnDef<Person>[] = [
  { accessorKey: "name", header: "Name", meta: { mobile: "primary" } },
];
const data: Person[] = [{ name: "Ada Lovelace" }];

const viewer = {
  title: (person: Person) => person.name,
  render: (person: Person) => person.name,
};

const loadMore = { hasNextPage: false, isFetching: false, onLoadMore: vi.fn() };

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
