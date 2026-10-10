// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinanceOverviewResponse, FinanceSummaryResponse, OverviewRange, Role } from "@routiq/contracts";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";

const navigate = vi.fn();
const routeSearch = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => routeSearch.current,
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: Record<string, string | undefined>;
    children?: ReactNode;
  }) => {
    const query = new URLSearchParams(
      Object.entries(search ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ).toString();
    return (
      <a href={query === "" ? to : `${to}?${query}`} {...props}>
        {children}
      </a>
    );
  },
}));

const window = (from: string, to: string, revenueMinor: number, expenseMinor: number, profit: boolean) => ({
  from,
  to,
  revenueMinor,
  expenseMinor,
  profitMinor: profit ? revenueMinor - expenseMinor : null,
});

const companyProfit = {
  vehicleProfitMinor: 0,
  revenueWithoutVehicleMinor: 0,
  companyCostsMinor: 0,
  companyProfitMinor: 0,
};

function overview(view: FinanceOverviewResponse["view"], range: OverviewRange = "THIS_MONTH"): FinanceOverviewResponse {
  const profit = view === "PROFIT";
  const months = range !== "THIS_MONTH";
  return {
    currency: "XAF",
    range,
    branchId: null,
    view,
    period: months
      ? window("2026-07-01", "2026-09-30", 27_000_000, 21_000_000, profit)
      : window("2026-10-01", "2026-10-09", 9_560_000, 7_690_000, profit),
    comparison: months
      ? window("2026-04-01", "2026-06-30", 25_000_000, 20_000_000, profit)
      : window("2026-09-01", "2026-09-09", 8_935_000, 6_928_000, profit),
    series: Array.from({ length: 12 }, (_unused, index) => ({
      periodCode: `2025-${String(index + 1).padStart(2, "0")}`,
      revenueMinor: 0,
      expenseMinor: 0,
    })),
    expensesByCategory: [
      {
        code: "REPAIRS",
        labelFr: "Réparations",
        labelEn: "Repairs",
        layer: null,
        period: { expenseMinor: 1_200_000, companyCostMinor: 0 },
        comparison: { expenseMinor: 780_000, companyCostMinor: 0 },
      },
      {
        code: "FUEL",
        labelFr: "Carburant",
        labelEn: "Fuel",
        layer: null,
        period: { expenseMinor: 3_900_000, companyCostMinor: 0 },
        comparison: { expenseMinor: 3_480_000, companyCostMinor: 0 },
      },
    ],
    vehicles: profit ? [] : null,
    branches: profit ? [] : null,
    companyProfit: profit ? { period: companyProfit, comparison: companyProfit } : null,
    counted: { postedEntries: 148, closedTrips: 27 },
    notCounted: {
      waitingApproval: { count: 6, amountMinor: 1_140_000 },
      missingReceipt: { count: 4, amountMinor: 586_000 },
      openTrips: 5,
      otherCurrencyEntries: 0,
    },
  };
}

const state = vi.hoisted(() => ({
  view: "PROFIT" as "PROFIT" | "REVENUE_AND_EXPENSES",
  ranges: [] as string[],
}));

vi.mock("../finance/useMoneyOverview.js", () => ({
  useMoneyOverview: (range: OverviewRange) => {
    state.ranges.push(range);
    return { data: overview(state.view, range), isPending: false, isError: false, refetch: vi.fn() };
  },
}));

const summary: FinanceSummaryResponse = {
  currency: "XAF",
  month: "2026-10",
  openPeriodCode: "2026-10",
  lastLockedPeriodCode: "2026-08",
  outMinor: 7_690_000,
  inMinor: 9_560_000,
  missingReceipt: { count: 4, oldestEconomicDate: "2026-10-02" },
  waiting: { count: 6, amountMinor: 1_140_000, oldestSubmittedAt: "2026-10-06T08:00:00.000Z" },
};

vi.mock("../finance/useFinanceSummary.js", () => ({
  useFinanceSummary: () => ({ data: summary, isPending: false, isError: false }),
}));

vi.mock("../finance/usePeriods.js", () => ({
  usePeriods: () => ({
    data: {
      currentPeriodCode: "2026-10",
      periods: [
        { periodCode: "2026-10", status: "OPEN", lockedAt: null, entryCount: 40, rowVersion: 1 },
        { periodCode: "2026-09", status: "OPEN", lockedAt: null, entryCount: 154, rowVersion: 1 },
      ],
    },
    isPending: false,
    isError: false,
  }),
}));

const { FinanceOverviewScreen } = await import("./FinanceOverviewScreen.js");

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
  };
}

function renderAs(role: Role) {
  return render(
    <MeCtx.Provider value={me(role)}>
      <FinanceOverviewScreen />
    </MeCtx.Provider>,
  );
}

function tiles() {
  return [...document.querySelectorAll<HTMLElement>('[data-slot="metric-tile"]')];
}

function tile(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-metric="${id}"]`);
  if (found === null) throw new Error(`no tile ${id}`);
  return found;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  navigate.mockClear();
  routeSearch.current = {};
  state.view = "PROFIT";
  state.ranges = [];
});

afterEach(cleanup);

describe("Money Overview (#664)", () => {
  it("shows finance the five tiles, each opening its tab already filtered", () => {
    renderAs("FINANCE");

    expect(tiles().map((node) => node.querySelector("dt")?.textContent)).toEqual([
      "Expenses",
      "Revenue",
      "To approve",
      "Missing receipt",
      "September 2026 close",
    ]);
    const href = (id: string) => tile(id).querySelector("a")?.getAttribute("href");
    expect(href("expenses")).toBe("/finance/entries?status=LEDGER&direction=EXPENSE&economicMonth=2026-10");
    expect(href("revenue")).toBe("/finance/entries?status=LEDGER&direction=REVENUE&economicMonth=2026-10");
    expect(href("approve")).toBe("/finance/approve");
    expect(href("missing")).toBe("/finance/entries?evidence=MISSING");
    expect(href("close")).toBe("/finance/entries?periodCode=2026-09");
  });

  it("compares each amount with the same days of last month, arrow and words", () => {
    renderAs("FINANCE");

    const text = (node: HTMLElement | null) => node?.textContent?.replace(/\s/g, " ") ?? "";
    expect(text(tile("expenses"))).toContain("▲ 11% vs Sep 1 – 9");
    expect(text(tile("revenue"))).toContain("▲ 7% vs Sep 1 – 9");
    expect(text(document.querySelector('[data-slot="money-overview-period"]'))).toBe(
      "October 1 – 9 compared with September 1 – 9",
    );
    expect(tile("close").textContent).toContain("Open");
  });

  it("ranks the categories by this period's spending, each with the comparison beside it", () => {
    renderAs("FINANCE");

    const card = document.querySelector<HTMLElement>('[data-slot="money-categories"]')!;
    const rows = within(card).getAllByRole("listitem").map((row) => row.textContent?.replace(/\s/g, " "));
    expect(rows[0]).toMatch(/^Fuel.*3,900,000 vs .*3,480,000$/);
    expect(rows[1]).toMatch(/^Repairs.*1,200,000 vs .*780,000$/);
  });

  it("lists what waits, each with its one button", () => {
    renderAs("FINANCE");

    const todo = document.querySelector<HTMLElement>('[data-slot="to-do-list"]')!;
    const rows = within(todo).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
      "6 entries wait for your approval",
      "4 entries have no receipt",
      "Close September 2026",
    ]);
    expect(rows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
      "/finance/approve",
      "/finance/entries?evidence=MISSING",
      "/finance/periods",
    ]);
  });

  it("says what the figures leave out", () => {
    renderAs("FINANCE");

    const line = document.querySelector('[data-slot="money-counted"]')?.textContent ?? "";
    expect(line).toContain("Counted: 148 posted entries.");
    expect(line).toContain("Not counted: 6 entries in the period wait for approval");
    expect(line).toContain("4 entries in the period have no receipt.");
    expect(line).toContain("5 activities are still open");
  });

  it("gives a cashier revenue and expenses, never profit, and no queue or month close", () => {
    state.view = "REVENUE_AND_EXPENSES";
    renderAs("CASHIER");

    expect(tiles().map((node) => node.querySelector("dt")?.textContent)).toEqual([
      "Expenses",
      "Revenue",
      "Missing receipt",
    ]);
    const page = document.querySelector('[data-slot="money-overview"]')?.textContent ?? "";
    expect(page).not.toMatch(/profit|loss/i);
    expect(page).not.toContain("wait for your approval");
    expect(page).not.toContain("Close September");
  });

  it("changes the range from the Overview, keeping it in the address", async () => {
    const user = userEvent.setup();
    renderAs("FINANCE");

    await user.click(screen.getByRole("radio", { name: "3 months" }));
    expect(navigate).toHaveBeenLastCalledWith({ to: "/finance", search: { range: "3-months" } });

    cleanup();
    routeSearch.current = { range: "3-months" };
    renderAs("FINANCE");
    expect(state.ranges.at(-1)).toBe("THREE_MONTHS");
    expect(screen.getByRole("radio", { name: "3 months" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-slot="money-overview-period"]')?.textContent?.replace(/\s/g, " ")).toBe(
      "July – September 2026 compared with April – June 2026",
    );
    // Whole months filter the list by kind; a single month would not match the figure.
    expect(tile("expenses").querySelector("a")?.getAttribute("href")).toBe(
      "/finance/entries?status=LEDGER&direction=EXPENSE",
    );
  });

  it("sends a driver, who has no Overview, to their entries", () => {
    renderAs("DRIVER");
    expect(navigate).toHaveBeenCalledWith({ to: "/finance/entries", replace: true });
    expect(document.querySelector('[data-slot="money-overview"]')).toBeNull();
  });
});
