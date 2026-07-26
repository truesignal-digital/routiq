// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table.js";

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

beforeEach(() => mockDesktop(true));
afterEach(cleanup);

describe("DataTable", () => {
  it("renders rows from columns and data", () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("grace@example.com")).toBeTruthy();
  });

  it("calls onLoadMore only when another page exists", async () => {
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
});
