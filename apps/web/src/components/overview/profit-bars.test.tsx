// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfitBars } from "./profit-bars.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const format = (value: number) => (value < 0 ? `Loss ${-value}` : `Profit ${value}`);

describe("ProfitBars", () => {
  it("puts losses first and writes the figure in words on every row", () => {
    const { container } = render(
      <ProfitBars
        format={format}
        rows={[
          { key: "a", label: "VH001", value: 400, to: "/assets/a" },
          { key: "b", label: "VH002", value: -86 },
        ]}
      />,
    );
    const rows = [...container.querySelectorAll("[data-slot=profit-bars-row]")];
    expect(rows.map((row) => row.textContent)).toEqual(["VH002Loss 86", "VH001Profit 400"]);
    expect(rows[0]?.hasAttribute("data-loss")).toBe(true);
    expect(screen.getByRole("link", { name: "VH001" }).getAttribute("href")).toBe("/assets/a");
    // The link's ::after covers its 44 px row, so a phone has a full-size target.
    expect(rows[1]?.className).toContain("relative");
    expect(screen.getByRole("link", { name: "VH001" }).className).toContain("after:inset-0");
  });

  it("keeps the losses when it folds rows away, and says how many it left out", () => {
    render(
      <ProfitBars
        format={format}
        maxRows={2}
        moreLabel={(count) => `${count} more`}
        rows={[
          { key: "a", label: "A", value: 10 },
          { key: "b", label: "B", value: -5 },
          { key: "c", label: "C", value: 30 },
        ]}
      />,
    );
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.queryByText("C")).toBeNull();
    expect(screen.getByText("1 more")).toBeTruthy();
  });
});
