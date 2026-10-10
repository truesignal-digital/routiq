// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetOverview, ComingUpResponse, FinanceOverviewResponse, FleetUsageResponse, ModuleCode, Role, TodoResponse } from "@routiq/contracts";
import { MeCtx, type MeContext } from "../auth/me.js";
import { DLA, internalFleetOverview, testOverview } from "../finance/dashboard/test-overview.js";
import { i18n } from "../i18n/index.js";
import { formatMoney } from "../lib/format.js";
import { testUsage } from "../overview/test-usage.js";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => ({}),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
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

const state = vi.hoisted(() => ({
  overview: undefined as FinanceOverviewResponse | undefined,
  branchId: undefined as string | undefined,
  mobile: false,
  todo: undefined as TodoResponse | undefined,
  comingUp: undefined as ComingUpResponse | undefined,
  usage: undefined as FleetUsageResponse | undefined,
  usageEnabled: [] as boolean[],
  fleet: undefined as AssetOverview | undefined,
}));

vi.mock("../overview/useMoneyOverview.js", () => ({
  useMoneyOverview: () => ({ data: state.overview, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("../overview/useFleetUsage.js", () => ({
  useFleetUsage: (_range: string, enabled: boolean) => {
    state.usageEnabled.push(enabled);
    return { data: enabled ? state.usage : undefined, isPending: false, isError: false };
  },
}));
vi.mock("../assets/useAssetOverview.js", () => ({
  useAssetOverview: () => ({ data: state.fleet, isPending: false }),
}));
vi.mock("../dashboard/useFleetAttention.js", () => ({
  useTodo: () => ({ data: state.todo, isError: false, refetch: vi.fn() }),
  useComingUp: () => ({ data: state.comingUp, isError: false, refetch: vi.fn() }),
}));
vi.mock("../shell/branch-context.js", () => ({ useAmbientBranchId: () => state.branchId }));
vi.mock("../hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }));

const { DashboardBranchesTab, DashboardOverviewTab, DashboardVehiclesTab } = await import("./FinanceDashboard.js");
const { overviewTiles } = await import("../assets/TrucksOverview.js");

/** The Trucks Overview's read: 12 vehicles not disposed, 10 of them can drive. */
const FLEET: AssetOverview = {
  total: 12,
  canDrive: 10,
  grounded: { count: 1, first: { assetId: "a3", assetCode: "VH003", since: "2026-10-01T08:00:00.000Z" } },
  idle: null,
  notice: { today: "2026-10-09", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] },
};

const SCOPE = { ambientBranch: "IGNORED" as const, branchIds: "ALL" as const };

function todo(count: number): TodoResponse {
  return {
    businessDate: "2026-10-09",
    scope: SCOPE,
    totalCount: count,
    rows: Array.from({ length: count }, (_, index) => ({
      code: "DOCUMENT_EXPIRING" as const,
      severity: "WARNING" as const,
      link: { kind: "document" as const, id: `00000000-0000-4000-8000-00000000000${index}`, number: null },
      asset: { id: "bbbbbbbb-0000-4000-8000-000000000005", assetCode: `VH10${index}` },
      branchId: DLA,
      since: "2026-10-01T00:00:00.000Z",
      params: { documentTypeLabelEn: "Insurance", documentTypeLabelFr: "Assurance", expiresAt: "2026-10-15", daysLeft: 6 },
    })),
  };
}

const COMING_UP: ComingUpResponse = {
  businessDate: "2026-10-09",
  windowDays: 14,
  scope: SCOPE,
  totalCount: 1,
  notCounted: ["SERVICE_DUE_BY_KM"],
  rows: [
    {
      code: "DOCUMENT_DUE",
      link: { kind: "document", id: "cccccccc-0000-4000-8000-000000000001", number: null },
      asset: { id: "bbbbbbbb-0000-4000-8000-000000000005", assetCode: "VH005" },
      branchId: DLA,
      dueDate: "2026-10-15",
      params: { documentTypeLabelEn: "Roadworthiness test", documentTypeLabelFr: "Visite technique", daysLeft: 6 },
    },
  ],
};

function me(role: Role = "DIRECTOR", enabledModules: ModuleCode[] = ["CORE", "ASSETS", "FINANCE"]): MeContext {
  return {
    workspaceId: "33333333-3333-4333-8333-333333333333",
    principalId: "44444444-4444-4444-8444-444444444444",
    principalType: "HUMAN",
    membershipId: "55555555-5555-4555-8555-555555555555",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role,
    branchScope: "ALL",
    enabledModules,
    enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
    timezone: "Africa/Douala",
  };
}

function renderTab(tab: ReactNode, membership = me()) {
  return render(<MeCtx.Provider value={membership}>{tab}</MeCtx.Provider>);
}

const money = (minor: number) => formatMoney(minor, { currency: "XAF" });
const tileValue = (id: string) =>
  document.querySelector(`[data-metric='${id}'] [data-slot='metric-value']`)?.textContent?.replace(/\s/g, " ");
const tileText = (id: string) => document.querySelector(`[data-metric='${id}']`)?.textContent ?? "";
const tileIds = () =>
  [...document.querySelectorAll("[data-slot='metric-tile'][data-metric]")].map((tile) => tile.getAttribute("data-metric"));
const digits = (text: string | null | undefined) => (text ?? "").replace(/\D/g, "");

beforeEach(async () => {
  await i18n.changeLanguage("en");
  state.overview = testOverview();
  state.branchId = undefined;
  state.mobile = false;
  state.todo = todo(7);
  state.comingUp = COMING_UP;
  state.usage = undefined;
  state.usageEnabled = [];
  state.fleet = FLEET;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard › Overview", () => {
  it("tiles revenue, expenses, profit with its share of revenue, and the vehicles that can drive", () => {
    renderTab(<DashboardOverviewTab />);
    expect(tileIds()).toEqual(["revenue", "expenses", "profit", "canDrive"]);
    expect(digits(tileValue("revenue"))).toBe("9560000");
    expect(digits(tileValue("expenses"))).toBe("7690000");
    expect(digits(tileValue("profit"))).toBe("1870000");
    expect(tileText("profit")).toContain("20% of revenue");
    expect(tileText("profit")).toContain("▼");
    expect(tileText("revenue")).toContain("▲ 7%");
    expect(tileValue("canDrive")).toBe("10 of 12");
    expect(tileText("canDrive")).toContain("2 cannot drive today");
  });

  it("shows the Trucks Overview's can-drive count and denominator, from the same read (#699)", () => {
    renderTab(<DashboardOverviewTab />);
    const [trucks] = overviewTiles({ overview: FLEET, summary: undefined, comingUp: null, groundingCounted: true, t: i18n.t, language: "en" });
    expect(trucks?.id).toBe("can-drive");
    expect(`${trucks?.value} ${trucks?.hint}`).toBe(tileValue("canDrive"));
  });

  it("calls an empty fleet empty and a fleet that can all drive whole", () => {
    state.fleet = { ...FLEET, total: 0, canDrive: 0, grounded: { count: 0, first: null } };
    renderTab(<DashboardOverviewTab />);
    expect(tileValue("canDrive")).toBe("0 of 0");
    expect(tileText("canDrive")).toContain("No vehicle is in the fleet yet");
    cleanup();
    state.fleet = { ...FLEET, canDrive: 12, grounded: { count: 0, first: null } };
    renderTab(<DashboardOverviewTab />);
    expect(tileText("canDrive")).toContain("Every vehicle in the fleet can drive");
  });

  it("says what profit is and what was not counted yet", () => {
    renderTab(<DashboardOverviewTab />);
    const counted = document.querySelector("[data-slot='dashboard-counted']")?.textContent ?? "";
    expect(counted).toContain("taxes and loan repayments aren't in it");
    expect(counted).toContain("84 posted entries and 27 closed");
    expect(counted).toContain("6 entries in the period wait for approval");
    expect(counted).toContain("5 ");
  });

  it("opens on the 1st with last month's summary above the tiles and the expenses jump named (#667)", () => {
    localStorage.clear();
    state.overview = testOverview({
      summary: {
        ...testOverview().summary,
        template: "AHEAD",
        window: "LAST_MONTH",
        period: { from: "2026-10-01", to: "2026-10-31" },
        comparison: { from: "2026-09-01", to: "2026-09-30" },
        currentMinor: 6_900_000,
        comparisonMinor: 6_440_000,
        reason: { kind: "REVENUE", category: null, changeMinor: 660_000 },
      },
      notice: {
        today: "2026-11-01",
        schedule: "MONDAY_AND_MONTH_START",
        scheduledOn: "2026-11-01",
        scheduledToday: "MONTH_START",
        changes: [{ kind: "EXPENSES_UP", key: "EXPENSES_UP:2026-10-01", expenseMinor: 7_690_000, comparisonExpenseMinor: 6_100_000, percent: 26 }],
      },
    });
    renderTab(<DashboardOverviewTab />);
    const region = screen.getByRole("region", { name: "Summary" });
    const text = region.textContent?.replace(/\s/g, " ") ?? "";
    expect(text).toContain("Start of the month summary · Sunday, November 1");
    expect(text).toContain("In October: a profit of FCFA 6,900,000 on FCFA 9,560,000 revenue, FCFA 460,000 better than September.");
    expect(text).toContain("Revenue rose by FCFA 660,000.");
    expect(text).toContain("Expenses are 26% above September.");
    expect(text).toContain("Ahead of September");
    // Above the tiles, with what it counted inside it.
    const tiles = document.querySelector("[data-slot='metric-strip']")!;
    expect(region.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.querySelector("[data-slot='dashboard-counted']")).toBeTruthy();
  });

  it("explains the change in a bridge whose table adds up to this month's profit", async () => {
    renderTab(<DashboardOverviewTab />);
    const why = document.querySelector("[data-slot='dashboard-why']") as HTMLElement;
    expect(within(why).getByText("What changed the profit")).toBeTruthy();
    // The waterfall: one bar per step, each naming its exact effect for hover and screen readers.
    const bars = [...why.querySelectorAll("[data-slot='profit-bridge-bar']")];
    expect(bars.map((bar) => bar.getAttribute("data-kind"))).toEqual([
      "total", "change", "change", "change", "change", "change", "change", "total",
    ]);
    expect(bars[2]?.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
      `Fuel: Lowered the profit: ${formatMoney(-420_000, { currency: "XAF", sign: { context: "net" } })}`,
    );
    await userEvent.click(within(why).getByRole("button", { name: "Table" }));
    const rows = [...why.querySelectorAll("[data-slot='profit-bridge-row']")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(rows.map(([label]) => label)).toEqual([
      expect.stringMatching(/Sep/),
      "Revenue",
      "Fuel",
      "Repairs",
      "Other vehicle costs",
      "Tolls and checkpoints",
      "Company costs",
      expect.stringMatching(/Oct/),
    ]);
    const signed = rows.slice(1, -1).map(([, value]) => (value?.includes("−") || value?.includes("-") ? -1 : 1) * Number(digits(value)));
    expect(1_970_000 + signed.reduce((sum, value) => sum + value, 0)).toBe(1_870_000);
    expect(digits(rows.at(-1)?.[1])).toBe("1870000");
  });

  it("puts the top five To do rows first on a phone, with a link to all of them", () => {
    renderTab(<DashboardOverviewTab />);
    const card = document.querySelector("[data-slot='dashboard-todo-card']") as HTMLElement;
    expect(card.className).toContain("order-first");
    expect(within(card).getAllByRole("listitem")).toHaveLength(5);
    expect(within(card).getByRole("link", { name: "See all 7" }).getAttribute("href")).toBe("/to-do");
    expect(within(card).getByText("Ranked by safety, then money · all your branches")).toBeTruthy();
  });

  it("lists vehicles losses first, then all vehicles − company costs = company profit", () => {
    renderTab(<DashboardOverviewTab />);
    const card = document.querySelector("[data-slot='dashboard-vehicles-card']") as HTMLElement;
    expect(within(card).getByText("Profit by vehicle")).toBeTruthy();
    const codes = [...card.querySelectorAll("tbody tr")].map((row) => row.textContent?.match(/VH\d+/)?.[0]);
    expect(codes).toEqual(["VH003", "VH002", "VH001"]);
    const lines = [...card.querySelectorAll("[data-slot='company-line']")].map((line) => [
      line.getAttribute("data-line"),
      digits(line.querySelector("dd")?.textContent),
    ]);
    expect(lines).toEqual([
      ["vehicles", "2510000"],
      ["companyCosts", "640000"],
      ["companyProfit", "1870000"],
    ]);
  });

  it("draws revenue and expenses for 12 months and vehicle profit by branch, with company costs left out", () => {
    renderTab(<DashboardOverviewTab />);
    expect(screen.getByText("Revenue and expenses per month")).toBeTruthy();
    const branches = document.querySelector("[data-slot='dashboard-branches-card']") as HTMLElement;
    expect(within(branches).getByText("Vehicle profit by branch")).toBeTruthy();
    expect([...branches.querySelectorAll("[data-slot='branch-bar']")].map((bar) => bar.querySelector("span")?.textContent)).toEqual([
      "Yaoundé",
      "Douala",
    ]);
    expect(branches.querySelector("[data-slot='company-costs-note']")?.textContent).toBe(
      `Company costs (${money(640_000)}) are not split by branch.`,
    );
  });

  it("lists what is coming up and says what it could not count", () => {
    renderTab(<DashboardOverviewTab />);
    const card = document.querySelector("[data-slot='dashboard-coming-up']") as HTMLElement;
    expect(within(card).getByText("VH005 Roadworthiness test")).toBeTruthy();
    expect(within(card).getByText(/ROUTIQ doesn't record service intervals yet/)).toBeTruthy();
  });

  it("shows only the chosen branch's vehicles and branch, and names the rest so the lines still add up", () => {
    state.branchId = DLA;
    renderTab(<DashboardOverviewTab />);
    const card = document.querySelector("[data-slot='dashboard-vehicles-card']") as HTMLElement;
    const codes = [...card.querySelectorAll("tbody tr")].map((row) => row.textContent?.match(/VH\d+/)?.[0]);
    expect(codes).toEqual(["VH003", "VH001"]);
    expect(card.querySelector("[data-line='other']")).not.toBeNull();
    const branches = document.querySelector("[data-slot='dashboard-branches-card']") as HTMLElement;
    expect(branches.querySelectorAll("[data-slot='branch-bar']")).toHaveLength(1);
  });

  it("on a phone: the bridge is a list that adds up and the vehicles card is the ones at a loss", () => {
    state.mobile = true;
    renderTab(<DashboardOverviewTab />);
    const why = document.querySelector("[data-slot='dashboard-why']") as HTMLElement;
    expect(why.querySelector("[data-slot='profit-bridge-list']")).not.toBeNull();
    expect(within(why).queryByRole("button", { name: "Table" })).toBeNull();
    const card = document.querySelector("[data-slot='dashboard-vehicles-card']") as HTMLElement;
    expect(within(card).getByText("Vehicles at a loss")).toBeTruthy();
    const losses = card.querySelectorAll("[data-slot='vehicles-at-a-loss'] li");
    expect(losses).toHaveLength(1);
    expect(losses[0]?.textContent).toContain("VH003");
  });

  it("gives an internal fleet with no revenue its expenses and costs, and no profit anywhere", () => {
    state.overview = internalFleetOverview();
    renderTab(<DashboardOverviewTab />);
    expect(tileIds()).toEqual(["expenses", "vehicleCosts", "companyCosts", "canDrive"]);
    expect(digits(tileValue("vehicleCosts"))).toBe("7050000");
    expect(digits(tileValue("companyCosts"))).toBe("640000");
    expect(screen.queryByText("What changed the profit")).toBeNull();
    expect(screen.getByText("What changed the expenses")).toBeTruthy();
    expect(screen.getByText("Cost by vehicle")).toBeTruthy();
    expect(screen.getByText("Expenses per month")).toBeTruthy();
    expect(screen.queryByText(/\bProfit\b/)).toBeNull();
    expect(screen.queryByText(/\bLoss\b/)).toBeNull();
  });

  it("leaves the vehicles tile out when the Vehicles module is off", () => {
    renderTab(<DashboardOverviewTab />, me("DIRECTOR", ["CORE", "FINANCE"]));
    expect(tileIds()).toEqual(["revenue", "expenses", "profit"]);
    expect(state.usageEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it("tiles cost per km against the same days of last month (#668)", () => {
    state.usage = testUsage();
    renderTab(<DashboardOverviewTab />);
    expect(tileIds()).toEqual(["revenue", "expenses", "profit", "cost-per-km", "canDrive"]);
    expect(digits(tileValue("cost-per-km"))).toBe("498");
    expect(tileText("cost-per-km")).toContain("/km");
    expect(tileText("cost-per-km")).toContain("▲ 4%");
  });

  it("says whose km are known when there is no cost per km to compare, and leaves the tile out without money", () => {
    const usage = testUsage();
    state.usage = { ...usage, money: usage.money === null ? null : { ...usage.money, comparison: { ...usage.money.comparison, costPerKmMinor: null } } };
    renderTab(<DashboardOverviewTab />);
    expect(tileText("cost-per-km")).toContain("Km known for 3 of 4 vehicles");
    cleanup();
    state.usage = { ...usage, money: null, vehicles: usage.vehicles.map((vehicle) => ({ ...vehicle, money: null })) };
    renderTab(<DashboardOverviewTab />);
    expect(tileIds()).not.toContain("cost-per-km");
  });
});

describe("Dashboard › Profit by vehicle and Profit by branch", () => {
  it("lists every vehicle, then the company lines", () => {
    renderTab(<DashboardVehiclesTab />);
    const codes = [...document.querySelectorAll("tbody tr")].map((row) => row.textContent?.match(/VH\d+/)?.[0]);
    expect(codes).toEqual(["VH003", "VH002", "VH001"]);
    expect(document.querySelector("[data-line='companyProfit']")).not.toBeNull();
    for (const header of ["Vehicle", "Branch", "Activities", "Km", "Revenue", "Expenses", "Profit"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
  });

  it("lists every branch with its vehicles, revenue, expenses and vehicle profit", () => {
    renderTab(<DashboardBranchesTab />);
    const rows = [...document.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent);
    expect(rows).toEqual(["Yaoundé", "Douala"]);
    for (const header of ["Branch", "Vehicles", "Revenue", "Expenses", "Vehicle profit"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(document.querySelector("[data-slot='company-costs-note']")?.textContent).toBe(
      `Company costs (${money(640_000)}) are not split by branch.`,
    );
  });
});
