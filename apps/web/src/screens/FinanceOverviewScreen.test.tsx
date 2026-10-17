// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinanceOverviewResponse, FinanceSummaryResponse, FleetUsageResponse, OverviewNotice, OverviewRange, Role } from "@routiq/contracts";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { testUsage } from "../overview/test-usage.js";

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
    summary: {
      template: "BEHIND",
      measure: profit ? "PROFIT" : "EXPENSES",
      window: "MONTH_SO_FAR",
      period: { from: "2026-10-01", to: "2026-10-09" },
      comparison: { from: "2026-09-01", to: "2026-09-09" },
      currentMinor: profit ? 1_870_000 : 7_690_000,
      comparisonMinor: profit ? 2_007_000 : 6_928_000,
      revenueMinor: profit ? 9_560_000 : null,
      changePercent: profit ? 7 : 11,
      reason: { kind: "CATEGORY", category: { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs" }, changeMinor: 420_000 },
      shortOf: null,
      trips: { closed: 27, open: 5 },
    },
    notice: state.notice,
  };
}

const usageState = vi.hoisted(() => ({
  current: undefined as FleetUsageResponse | undefined,
  calls: [] as { range: string; enabled: boolean }[],
}));

const NOT_DUE: OverviewNotice = { today: "2026-10-09", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] };

const state = vi.hoisted(() => ({
  view: "PROFIT" as "PROFIT" | "REVENUE_AND_EXPENSES",
  ranges: [] as string[],
  notice: { today: "2026-10-09", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] } as OverviewNotice,
}));

vi.mock("../overview/useFleetUsage.js", () => ({
  useFleetUsage: (range: OverviewRange, enabled: boolean) => {
    usageState.calls.push({ range, enabled });
    return { data: enabled ? usageState.current : undefined, isPending: false, isError: false };
  },
}));

vi.mock("../overview/useMoneyOverview.js", () => ({
  useMoneyOverview: (range: OverviewRange) => {
    state.ranges.push(range);
    return { data: overview(state.view, range), isPending: false, isError: false, refetch: vi.fn() };
  },
}));

const summary: FinanceSummaryResponse = {
  currency: "XAF",
  month: "2026-10",
  unlockedPeriodCodes: ["2026-09"],
  lastLockedPeriodCode: "2026-08",
  outMinor: 7_690_000,
  inMinor: 9_560_000,
  missingReceipt: { count: 4, oldestEconomicDate: "2026-10-02" },
  waiting: { count: 6, amountMinor: 1_140_000, oldestSubmittedAt: "2026-10-06T08:00:00.000Z" },
};

const summaryState = { current: summary };

vi.mock("../finance/useFinanceSummary.js", () => ({
  useFinanceSummary: () => ({ data: summaryState.current, isPending: false, isError: false }),
}));

const septemberState = { current: { status: "OPEN" as "OPEN" | "LOCKED", lockedAt: null as string | null } };

vi.mock("../finance/usePeriods.js", () => ({
  usePeriods: () => ({
    data: {
      currentPeriodCode: "2026-10",
      periods: [
        { periodCode: "2026-10", status: "OPEN", lockedAt: null, entryCount: 40, rowVersion: 1 },
        { periodCode: "2026-09", ...septemberState.current, entryCount: 154, rowVersion: 1 },
      ],
    },
    isPending: false,
    isError: false,
  }),
}));

const { closeHint, FinanceOverviewScreen } = await import("./FinanceOverviewScreen.js");

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
  summaryState.current = summary;
  septemberState.current = { status: "OPEN", lockedAt: null };
  navigate.mockClear();
  routeSearch.current = {};
  state.view = "PROFIT";
  state.ranges = [];
  usageState.current = testUsage();
  usageState.calls = [];
  state.notice = NOT_DUE;
  localStorage.clear();
});

afterEach(cleanup);

describe("Money Overview (#664)", () => {
  it("shows the period's two figures, each opening Entries already filtered; what waits is the To do, not a tile", () => {
    renderAs("FINANCE");

    expect(tiles().map((node) => node.querySelector("dt")?.textContent)).toEqual(["Expenses", "Revenue"]);
    const href = (id: string) => tile(id).querySelector("a")?.getAttribute("href");
    expect(href("expenses")).toBe("/finance/entries?status=LEDGER&direction=EXPENSE&economicMonth=2026-10");
    expect(href("revenue")).toBe("/finance/entries?status=LEDGER&direction=REVENUE&economicMonth=2026-10");
  });

  it("compares each amount with the same days of last month, arrow and words", () => {
    renderAs("FINANCE");

    const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s/g, " ") ?? "";
    expect(text(tile("expenses"))).toContain("▲ 11% vs 1–9 Sept");
    expect(text(tile("revenue"))).toContain("▲ 7% vs 1–9 Sept");
    expect(text(document.querySelector('[data-slot="money-overview-period"]'))).toBe("1–9 Oct vs 1–9 Sept");
    // The month close's state and its entry count ride on its To do row.
    const close = [...document.querySelectorAll('[data-slot="to-do-row"]')].at(-1);
    expect(text(close)).toContain("September 2026 still open");
    expect(text(close)).toContain("154 entries");
  });

  it("folds a locked last month into one passed line, with no close row", () => {
    septemberState.current = { status: "LOCKED", lockedAt: "2026-10-03T08:00:00.000Z" };
    summaryState.current = { ...summary, unlockedPeriodCodes: [], lastLockedPeriodCode: "2026-09" };
    renderAs("FINANCE");
    const card = document.querySelector('[data-slot="money-todo"]') as HTMLElement;
    expect(card.querySelector('[data-slot="money-month-locked"]')?.textContent).toBe("Closed: September 2026");
    expect(card.textContent).not.toContain("still open");
  });

  it("says no month is closed while last month is open", () => {
    renderAs("FINANCE");
    expect(document.querySelector('[data-slot="money-month-locked"]')).toBeNull();
  });

  it("names the earlier months still not locked under the close (#526)", () => {
    expect(closeHint("2026-09", undefined, ["2026-07", "2026-08", "2026-09"], i18n.t.bind(i18n), "en")).toEqual({
      hint: "Earlier, not locked: July 2026 and August 2026",
    });
    expect(
      closeHint("2026-09", undefined, ["2026-03", "2026-04", "2026-05", "2026-06"], i18n.t.bind(i18n), "en"),
    ).toEqual({ hint: "4 earlier months not locked" });
  });

  it("ranks the categories by this period's spending, each with the comparison beside it", () => {
    renderAs("FINANCE");

    const card = document.querySelector<HTMLElement>('[data-slot="money-categories"]')!;
    const rows = within(card).getAllByRole("listitem").map((row) => row.textContent?.replace(/\s/g, " "));
    expect(rows[0]).toMatch(/^Fuel.*3 900 000 FCFA vs .*3 480 000 FCFA$/);
    expect(rows[1]).toMatch(/^Repairs.*1 200 000 FCFA vs .*780 000 FCFA$/);
  });

  it("leads with what waits, each row one kind of work with its count and its verb", () => {
    renderAs("FINANCE");

    const todo = document.querySelector<HTMLElement>('[data-slot="to-do-list"]')!;
    // First on the page: before the figures.
    const tilesStrip = document.querySelector('[data-slot="metric-strip"]')!;
    expect(todo.compareDocumentPosition(tilesStrip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = within(todo).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
      "6 entries wait for your approval",
      "4 entries have no receipt",
      "September 2026 still open",
    ]);
    expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual(["Review", "Add receipts", "Close month"]);
    expect(rows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
      "/finance/approve",
      "/finance/entries?evidence=MISSING",
      "/finance/periods",
    ]);
    expect(rows[0]?.textContent?.replace(/\s/g, " ")).toContain("1 140 000 FCFA");
  });

  it("warns at rest that not everything is counted, and says what is left out one tap away (§9)", async () => {
    renderAs("FINANCE");

    const verdict = document.querySelector<HTMLElement>('[data-slot="money-verdict"]')!;
    // The summary reads its own month whatever the range, so the line names it.
    expect(verdict.querySelector('[data-slot="money-verdict-month"]')?.textContent).toBe("October");
    const warning = within(verdict).getByRole("button", { name: "Not everything is counted" });
    expect(warning.className).toContain("text-warning-foreground");
    await userEvent.click(warning);
    const line = (await screen.findByRole("dialog", { name: "Not everything is counted" })).textContent?.replace(/\s/g, " ") ?? "";
    expect(line).toContain(
      "So far in October: a profit of 1 870 000 FCFA on 9 560 000 FCFA revenue, 137 000 FCFA worse than September at the same day.",
    );
    expect(line).toContain("Counted: 148 posted entries.");
    expect(line).toContain("Not counted: 6 entries in the period wait for approval");
    expect(line).toContain("4 entries in the period have no receipt.");
    expect(line).toContain("5 activities are still open");
  });

  it("opens on a Monday with the summary notice under To do and above the tiles; closed, it stays closed after a reload (#667)", async () => {
    state.notice = { today: "2026-10-05", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: "MONDAY", changes: [] };
    renderAs("FINANCE");
    const region = screen.getByRole("region", { name: "Summary" });
    expect(region.getAttribute("data-reason")).toBe("MONDAY");
    expect(region.textContent?.replace(/\s/g, " ")).toContain(
      "So far in October: a profit of 1 870 000 FCFA on 9 560 000 FCFA revenue, 137 000 FCFA worse than September at the same day.",
    );
    expect(region.textContent).toContain("Spending on Repairs rose by");
    // The verdict and the completeness warning are the notice's counted line while it is open.
    const verdict = region.querySelector<HTMLElement>('[data-slot="money-verdict"]')!;
    expect(verdict.closest('[data-summary="open"]')).toBeTruthy();
    expect(within(verdict).getByText("Behind September")).toBeTruthy();
    expect(within(verdict).getByRole("button", { name: "Not everything is counted" }).className).toContain("text-warning-foreground");
    const todo = document.querySelector('[data-slot="money-todo"]')!;
    const strip = document.querySelector('[data-slot="metric-strip"]')!;
    expect(todo.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(within(region).getByRole("button", { name: "Close the summary" }));
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    const closed = document.querySelector<HTMLElement>('[data-slot="money-verdict"]')!;
    expect(closed.closest('[data-summary="closed"]')).toBeTruthy();
    expect(within(closed).getByRole("button", { name: "Not everything is counted" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show summary" })).toBeTruthy();

    cleanup();
    renderAs("FINANCE");
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show summary" }));
    expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain("So far in October");
  });

  it("on a day it is not due shows only the verdict and its warning under the tiles, with Show summary (#667)", () => {
    renderAs("FINANCE");
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    const verdict = document.querySelector<HTMLElement>('[data-slot="money-verdict"]')!;
    const line = verdict.closest<HTMLElement>('[data-summary="closed"]')!;
    expect(line).toBeTruthy();
    expect(within(line).getByRole("button", { name: "Show summary" })).toBeTruthy();
    expect(document.querySelector('[data-slot="metric-strip"]')!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives a cashier revenue and expenses, never profit, and no queue or month close", () => {
    state.view = "REVENUE_AND_EXPENSES";
    renderAs("CASHIER");

    expect(tiles().map((node) => node.querySelector("dt")?.textContent)).toEqual(["Expenses", "Revenue"]);
    const rows = [...document.querySelectorAll('[data-slot="to-do-row"]')].map((row) => row.querySelector("p")?.textContent);
    expect(rows).toEqual(["4 entries have no receipt"]);
    const page = document.querySelector('[data-slot="money-overview"]')?.textContent ?? "";
    expect(page).not.toMatch(/profit|loss/i);
    expect(page).not.toContain("wait for your approval");
    expect(page).not.toContain("September 2026 still open");
  });

  it("shows what waits for approval at rest to a role with no To approve row, and once only when an approver's row says the same (§9)", () => {
    state.view = "REVENUE_AND_EXPENSES";
    renderAs("CASHIER");
    const waiting = document.querySelector<HTMLElement>('[data-slot="money-waiting"]');
    // At rest, not behind the counted popover: no dialog is open.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(waiting?.textContent?.replace(/\s/g, " ")).toBe("6 wait for approval · 1 140 000 FCFA");
    expect(waiting?.className).toContain("text-warning-foreground");

    cleanup();
    state.view = "PROFIT";
    renderAs("FINANCE");
    // The approver's To do row already carries the count and the amount.
    expect(document.querySelector('[data-slot="money-waiting"]')).toBeNull();
    const rows = [...document.querySelectorAll('[data-slot="to-do-row"]')].map((row) => row.textContent?.replace(/\s/g, " ") ?? "");
    expect(rows.filter((row) => row.includes("1 140 000 FCFA"))).toHaveLength(1);
    expect(rows[0]).toContain("6 entries wait for your approval");
  });

  it("still shows the period's pending total to an approver who may decide none of it (§9)", () => {
    summaryState.current = { ...summary, waiting: { count: 0, amountMinor: 0, oldestSubmittedAt: null } };
    renderAs("FINANCE");
    const waiting = document.querySelector<HTMLElement>('[data-slot="money-waiting"]');
    expect(waiting?.textContent?.replace(/\s/g, " ")).toBe("6 wait for approval · 1 140 000 FCFA");
    const rows = [...document.querySelectorAll('[data-slot="to-do-row"]')].map((row) => row.textContent ?? "");
    expect(rows.some((row) => row.includes("wait for your approval"))).toBe(false);
  });

  it("shows the period's total beside an approver's row when the row counts only part of it", () => {
    summaryState.current = { ...summary, waiting: { count: 2, amountMinor: 300_000, oldestSubmittedAt: null } };
    renderAs("FINANCE");
    expect(document.querySelector('[data-slot="money-waiting"]')?.textContent?.replace(/\s/g, " ")).toBe(
      "6 wait for approval · 1 140 000 FCFA",
    );
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
      "Jul – Sept 2026 vs Apr – Jun 2026",
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

  it("tells the cashier about expenses, never profit", async () => {
    state.view = "REVENUE_AND_EXPENSES";
    renderAs("CASHIER");
    await userEvent.click(screen.getByRole("button", { name: "Not everything is counted" }));
    const text = (await screen.findByRole("dialog", { name: "Not everything is counted" })).textContent ?? "";
    expect(text.replace(/\s/g, " ")).toContain("So far in October: 7 690 000 FCFA of expenses, 11% more than September at the same day.");
    expect(text).not.toMatch(/profit/i);
  });
});

describe("Money Overview › Fuel per km by truck (#668)", () => {
  const card = () => document.querySelector<HTMLElement>('[data-slot="fuel-per-km-by-truck"]');

  it("ranks fuel per km against the fleet median, flags the outlier and links each truck", async () => {
    renderAs("FINANCE");
    const found = card();
    if (found === null) throw new Error("no fuel card");
    const rows = [...found.querySelectorAll("[data-slot=ranked-bars-row]")];
    expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual(["VH007", "VH003", "VH001"]);
    expect(rows[0]?.hasAttribute("data-flagged")).toBe(true);
    expect(rows[0]?.textContent).toContain("24% above the median");
    expect(within(found).getByRole("link", { name: "VH007" }).getAttribute("href")).toBe("/assets/a7");
    expect(found.textContent?.replace(/\s/g, " ")).toMatch(/Fleet median \S*\s?300/);
    // Vehicles left out are a warning at rest; which ones and how it is worked out, one tap away.
    const warning = within(found).getByRole("button", { name: "Not everything is counted" });
    expect(warning.className).toContain("text-warning-foreground");
    await userEvent.click(warning);
    expect((await screen.findByRole("dialog", { name: "Not everything is counted" })).textContent).toContain(
      "Not counted: 1 vehicle whose km are not known.",
    );
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(found).getByRole("button", { name: "How fuel per km is worked out" }));
    expect((await screen.findByRole("dialog", { name: "How fuel per km is worked out" })).textContent).toContain(
      "Fuel expenses ÷ km from legs or the odometer.",
    );
  });

  it("reads the page's range", () => {
    routeSearch.current = { range: "3-months" };
    renderAs("FINANCE");
    expect(usageState.calls.at(-1)).toEqual({ range: "THREE_MONTHS", enabled: true });
  });

  it("leaves the card out for the cashier, who reads no vehicle money, and never asks", () => {
    renderAs("CASHIER");
    expect(card()).toBeNull();
    expect(usageState.calls.every((call) => !call.enabled)).toBe(true);
  });
});
