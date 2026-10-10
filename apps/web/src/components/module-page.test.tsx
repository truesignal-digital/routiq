// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModulePage } from "./module-page.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const tabs = [
  { key: "overview", label: "Overview", to: "/x" },
  { key: "list", label: "List", to: "/x/list" },
  { key: "queue", label: "Queue", to: "/x/queue", count: 3, countLabel: "3 waiting" },
] as const;

describe("ModulePage (#664)", () => {
  it("draws the header once, then the tabs as links, the active one selected", () => {
    render(
      <ModulePage title="Money" description="Every revenue and expense." tabs={tabs} active="list" tabsLabel="Sections">
        <p>Body</p>
      </ModulePage>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Money");
    expect(screen.getByText("Every revenue and expense.")).toBeTruthy();
    const triggers = screen.getAllByRole("tab");
    expect(triggers.map((tab) => tab.getAttribute("href"))).toEqual(["/x", "/x/list", "/x/queue"]);
    expect(triggers.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(triggers[2]?.textContent).toBe("Queue3 3 waiting");
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("draws no bar for a single tab and no count at zero", () => {
    const { rerender } = render(
      <ModulePage title="Money" tabs={[tabs[1]]} active="list" tabsLabel="Sections">
        <p>Body</p>
      </ModulePage>,
    );
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();

    rerender(
      <ModulePage title="Money" tabs={[tabs[0], { ...tabs[2], count: 0 }]} active="overview" tabsLabel="Sections">
        <p>Body</p>
      </ModulePage>,
    );
    expect(document.querySelector('[data-slot="module-page-tab-count"]')).toBeNull();
  });
});
