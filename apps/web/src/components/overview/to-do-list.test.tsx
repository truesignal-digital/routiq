// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToDoList, type ToDoItem } from "./to-do-list.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const item = (n: number): ToDoItem => ({
  key: String(n),
  title: `Thing ${n}`,
  action: { label: `Do ${n}`, to: `/do/${n}` },
});

describe("ToDoList", () => {
  it("keeps the first five rows, one button each", () => {
    render(<ToDoList items={[1, 2, 3, 4, 5, 6].map(item)} empty="Nothing" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Do 1" }).getAttribute("href")).toBe("/do/1");
    expect(screen.queryByText("Thing 6")).toBeNull();
  });

  it("says when nothing waits instead of drawing an empty card", () => {
    render(<ToDoList items={[]} empty="Nothing waits for you." />);
    expect(screen.getByText("Nothing waits for you.")).toBeTruthy();
  });
});
