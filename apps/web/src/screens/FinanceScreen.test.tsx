// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@routiq/contracts";
import { MeCtx, type MeContext } from "../auth/me.js";

vi.mock("react-i18next", async () => ({
  ...(await vi.importActual("react-i18next")),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.["count"] === undefined ? key : `${key}:${String(options["count"])}`,
    i18n: { resolvedLanguage: "en", exists: () => true, t: (key: string) => key },
  }),
}));

const location = vi.hoisted(() => ({ pathname: "/finance" }));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location }),
  Outlet: () => <div data-testid="tab-content" />,
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const summary = vi.hoisted(() => ({
  current: { waiting: { count: 6, amountMinor: 1_140_000, oldestSubmittedAt: null } } as {
    waiting: { count: number; amountMinor: number; oldestSubmittedAt: string | null } | null;
  },
}));

vi.mock("../finance/useFinanceSummary.js", () => ({
  useFinanceSummary: () => ({ data: summary.current, isPending: false, isError: false }),
}));

const { FinanceScreen } = await import("./FinanceScreen.js");

function me(role: Role): MeContext {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    principalId: "00000000-0000-4000-8000-000000000002",
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-000000000003",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role,
    branchScope: "ALL",
    enabledModules: ["CORE", "ASSETS", "ACTIVITIES", "FINANCE"],
    enabledPresets: ["TRUCKING"],
    timezone: "Africa/Douala",
  };
}

function renderAs(role: Role, pathname = "/finance") {
  location.pathname = pathname;
  return render(
    <MeCtx.Provider value={me(role)}>
      <FinanceScreen />
    </MeCtx.Provider>,
  );
}

function tabNames(): string[] {
  const nav = screen.queryByRole("navigation", { name: "finance.page.tabs.label" });
  if (nav === null) return [];
  return within(nav)
    .getAllByRole("tab")
    .map((tab) => tab.textContent ?? "");
}

beforeEach(() => {
  summary.current = { waiting: { count: 6, amountMinor: 1_140_000, oldestSubmittedAt: null } };
});

afterEach(cleanup);

describe("Money page (#664)", () => {
  it("opens with the header, then Overview first, Entries, and To approve with its count", () => {
    renderAs("FINANCE");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("finance.entries.title");
    expect(screen.getByText("finance.page.description")).toBeTruthy();
    expect(screen.getByRole("link", { name: /commands\.record-expense\.label/ }).getAttribute("href")).toBe(
      "/finance/record",
    );
    expect(tabNames()).toEqual([
      "finance.page.tabs.overview",
      "finance.page.tabs.entries",
      "finance.page.tabs.approve6 finance.page.tabs.waitingCount:6",
    ]);
    expect(screen.getByTestId("tab-content")).toBeTruthy();
  });

  it("puts every tab at its own address", () => {
    renderAs("DIRECTOR");
    const links = within(screen.getByRole("navigation", { name: "finance.page.tabs.label" }))
      .getAllByRole("tab")
      .map((tab) => tab.getAttribute("href"));
    expect(links).toEqual(["/finance", "/finance/entries", "/finance/approve"]);
  });

  it.each([
    ["/finance", "finance.page.tabs.overview"],
    ["/finance/entries", "finance.page.tabs.entries"],
    ["/finance/record", "finance.page.tabs.entries"],
    ["/finance/approve", "finance.page.tabs.approve"],
  ])("marks the tab the address is on (%s), and keeps the same header", (pathname, active) => {
    renderAs("FINANCE", pathname);
    const selected = screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain(active);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("finance.entries.title");
  });

  it("shows no count when nothing waits", () => {
    summary.current = { waiting: { count: 0, amountMinor: 0, oldestSubmittedAt: null } };
    renderAs("FINANCE");
    expect(document.querySelector('[data-slot="module-page-tab-count"]')).toBeNull();
  });

  it("hides To approve from a cashier, who keeps Overview and Entries", () => {
    renderAs("CASHIER");
    expect(tabNames()).toEqual(["finance.page.tabs.overview", "finance.page.tabs.entries"]);
  });

  it("gives a driver their own entries with no tab bar: one tab is no choice", () => {
    renderAs("DRIVER", "/finance/entries");
    expect(screen.queryByRole("navigation", { name: "finance.page.tabs.label" })).toBeNull();
    expect(screen.getByText("finance.page.descriptionOwn")).toBeTruthy();
    expect(screen.getByRole("link", { name: /commands\.record-expense\.label/ })).toBeTruthy();
  });

  it("turns the workshop away, header and all: its costs live on work orders", () => {
    renderAs("TECHNICIAN");
    expect(screen.queryByRole("link", { name: /commands\.record-expense\.label/ })).toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });
});
