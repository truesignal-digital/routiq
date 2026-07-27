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
});
