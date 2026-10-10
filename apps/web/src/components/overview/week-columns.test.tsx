// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeekColumns } from "./week-columns.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("WeekColumns", () => {
  it("names each column in words and links it to its week", () => {
    render(
      <WeekColumns
        doneLabel="Closed"
        openLabel="Still open"
        columns={[
          { key: "w1", label: "Sep 28", total: 4, done: 4, description: "Week of Sep 28: 4 started, 4 closed", link: { to: "/w1" } },
          { key: "w2", label: "Oct 5", total: 2, done: 1, description: "Week of Oct 5: 2 started, 1 closed", link: { to: "/w2" } },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Week of Oct 5: 2 started, 1 closed" }).getAttribute("href")).toBe("/w2");
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("draws an empty week as an empty column, never as a missing one", () => {
    const { container } = render(
      <WeekColumns
        doneLabel="Closed"
        openLabel="Still open"
        columns={[{ key: "w1", label: "Sep 28", total: 0, done: 0, description: "Week of Sep 28: 0 started, 0 closed" }]}
      />,
    );
    expect(container.querySelectorAll("[data-slot=week-column]")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Week of Sep 28: 0 started, 0 closed" })).toBeTruthy();
  });
});
