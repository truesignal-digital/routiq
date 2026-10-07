// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type {
  DashboardResponse,
  FinancialEntryListResponse,
  ModuleCode,
  Role,
} from "@routiq/contracts";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { entryVehicleFields } from "../test-entry-fields.js";

const session = {
  username: "ada",
  workspaceSlug: "transports-douala",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

vi.mock("../auth/store.js", () => ({
  sessionStore: {
    getActive: () => session,
    getToken: () => "token",
    logout: vi.fn(),
  },
  useActiveSession: () => session,
}));

const { DashboardScreen } = await import("./DashboardScreen.js");

const FLAT_SERIES = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-07-2${index}`,
  expenseMinor: 0,
  revenueMinor: 0,
}));

const dashboard: DashboardResponse = {
  assets: {
    total: 12,
    byStatus: {
      REGISTERED: 2,
      IN_SERVICE: 9,
      UNDER_MAINTENANCE: 1,
      SOLD: 0,
      RETIRED: 0,
      WRITTEN_OFF: 0,
    },
  },
  openPeriod: {
    periodCode: "2026-07",
    postedExpenseMinor: 450000,
    postedRevenueMinor: 1200000,
    currency: "XAF",
  },
  pendingApprovals: { count: 3, outsideBranchCount: 0 },
  series: [
    { date: "2026-07-20", expenseMinor: 0, revenueMinor: 0 },
    { date: "2026-07-21", expenseMinor: 15000, revenueMinor: 42000 },
    { date: "2026-07-22", expenseMinor: 8000, revenueMinor: 0 },
  ],
};

const entries: FinancialEntryListResponse = {
  entries: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      entryNumber: "ENT-0042",
      direction: "EXPENSE",
      status: "POSTED",
      category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: null },
      amountMinor: -50000,
      currency: "XAF",
      economicDate: "2026-07-22",
      postingPeriodCode: "2026-07",
      isLatePosting: false,
      branchId: "branch-1",
      counterpartyName: "Station Shell",
      paymentMethod: "CASH",
      estimateStatus: "ACTUAL",
      postedAt: "2026-07-22T10:00:00Z",
      rowVersion: 1,
      reversesEntryId: null,
      ...entryVehicleFields,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      entryNumber: "ENT-0041",
      direction: "REVENUE",
      status: "SUBMITTED",
      category: { code: "FREIGHT", labelFr: "Fret", labelEn: "Freight", layer: null },
      amountMinor: 120000,
      currency: "XAF",
      economicDate: "2026-07-21",
      postingPeriodCode: "2026-07",
      isLatePosting: false,
      branchId: "branch-1",
      counterpartyName: null,
      paymentMethod: "MOMO",
      estimateStatus: "ACTUAL",
      postedAt: null,
      rowVersion: 1,
      reversesEntryId: null,
      ...entryVehicleFields,
    },
  ],
  nextCursor: "cursor-1",
};

interface FetchScript {
  dashboard?: DashboardResponse;
  dashboardStatus?: number;
  entriesStatus?: number;
  /** Resolved only when the test releases it, to hold the loading state. */
  hold?: boolean;
}

const requested: string[] = [];

function installFetch(script: FetchScript = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);

    if (url.startsWith("/v1/dashboard")) {
      if (script.hold) return new Promise<Response>(() => {});
      const status = script.dashboardStatus ?? 200;
      return jsonResponse(script.dashboard ?? dashboard, status);
    }
    if (url.startsWith("/v1/finance/entries")) {
      return jsonResponse(entries, script.entriesStatus ?? 200);
    }
    throw new Error(`unexpected request: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function membership(role: Role, enabledModules: ModuleCode[]): MeContext {
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
  };
}

const ENTRY_DETAIL_PATH = "/finance/entries/$entryId";

async function renderHome(me: MeContext) {
  const rootRoute = createRootRoute();
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: DashboardScreen,
  });
  const otherRoutes = ["/assets", "/finance/entries", "/finance/approvals"].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <div data-testid="elsewhere">{path}</div>,
    }),
  );
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: ENTRY_DETAIL_PATH,
    component: () => <div data-testid="elsewhere">entry detail</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, ...otherRoutes, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MeCtx.Provider value={me}>
          <RouterProvider router={router} />
        </MeCtx.Provider>
      </QueryClientProvider>
    </I18nextProvider>,
  );

  return router;
}

/** The KPI value a card is currently showing, by its stable slot attribute. */
function kpiValue(key: string): string | undefined {
  return document
    .querySelector(`[data-kpi='${key}'] [data-slot='kpi-value']`)
    ?.textContent?.trim();
}

function kpiKeys(): string[] {
  return [...document.querySelectorAll("[data-kpi]")].map(
    (card) => card.getAttribute("data-kpi") ?? "",
  );
}

function dashboardRequests(): string[] {
  return requested.filter((url) => url.startsWith("/v1/dashboard"));
}

beforeEach(async () => {
  requested.length = 0;
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardScreen — KPI cards", () => {
  it("prints the numbers the aggregate read returned, counting nothing itself", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiValue("pendingApprovals")).toBe("3"));
    // 9 in service out of 12 — the byStatus bucket, not a filter over a list.
    expect(kpiValue("assets")).toBe("9");
    expect(screen.getByText("of 12 registered assets")).toBeTruthy();
    expect(kpiValue("openPeriodExpense")).toContain("450");
    expect(kpiValue("openPeriodRevenue")).toContain("1");
    expect(screen.getAllByText("Open period 2026-07").length).toBe(2);
  });

  it("shows skeletons rather than zeros while the aggregate is in flight", async () => {
    installFetch({ hold: true });
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiKeys().length).toBe(4));
    expect(kpiValue("pendingApprovals")).toBeUndefined();
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
  });

  it("offers a retry banner when the read fails, and no invented numbers", async () => {
    installFetch({ dashboardStatus: 500 });
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("We couldn't load the dashboard");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(kpiValue("pendingApprovals")).toBe("—");
  });

  it("reports an em dash, never a zero, when no period is open yet", async () => {
    installFetch({ dashboard: { ...dashboard, openPeriod: null } });
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiValue("openPeriodExpense")).toBe("—"));
    expect(screen.getAllByText("No open period yet").length).toBe(2);
  });

  it("names the pending work the branch narrowing left out of the count", async () => {
    installFetch({
      dashboard: {
        ...dashboard,
        pendingApprovals: { count: 3, outsideBranchCount: 2 },
      },
    });
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiValue("pendingApprovals")).toBe("3"));
    const overflow = screen.getByRole("link", {
      name: "+2 pending in other branches",
    });
    // Landing on the queue as preset would re-apply the very narrowing this
    // line is counting around, so it carries the widening with it.
    expect(overflow.getAttribute("href")).toBe("/finance/approvals?branch=all");
    // The card itself still lands preset.
    expect(
      screen
        .getByRole("link", { name: "Pending approvals" })
        .getAttribute("href"),
    ).toBe("/finance/approvals");
  });

  it("says nothing about other branches when the count is the whole queue", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiValue("pendingApprovals")).toBe("3"));
    expect(document.querySelector("[data-slot='kpi-secondary']")).toBeNull();
  });

  it("phrases an empty approvals queue rather than pluralizing zero", async () => {
    installFetch({
      dashboard: {
        ...dashboard,
        pendingApprovals: { count: 0, outsideBranchCount: 0 },
      },
    });
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiValue("pendingApprovals")).toBe("0"));
    expect(screen.getByText("Nothing awaiting your decision")).toBeTruthy();
  });
});

describe("DashboardScreen — gating", () => {
  it("drops every finance card, the chart and the recent list without the module", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS"]));

    await waitFor(() => expect(kpiKeys()).toEqual(["assets"]));
    expect(screen.queryByText("Expense and revenue")).toBeNull();
    expect(screen.queryByText("Recent entries")).toBeNull();
    expect(requested.some((url) => url.startsWith("/v1/finance/entries"))).toBe(false);
  });

  it("drops the assets card without the assets module", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "FINANCE"]));

    await waitFor(() =>
      expect(kpiKeys()).toEqual([
        "pendingApprovals",
        "openPeriodExpense",
        "openPeriodRevenue",
      ]),
    );
  });

  it("hides the approvals card from a role that cannot approve", async () => {
    installFetch();
    await renderHome(membership("ADMIN", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiKeys().length).toBe(3));
    expect(kpiKeys()).not.toContain("pendingApprovals");
  });

  it("lets the Administrateur trace totals and recent entries", async () => {
    installFetch();
    await renderHome(membership("ADMIN", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(kpiValue("openPeriodRevenue")).toBeTruthy());
    expect(screen.getByRole("link", { name: /Period revenue/ })).toBeTruthy();
    expect(await screen.findByText("Recent entries")).toBeTruthy();
  });
});

describe("DashboardScreen — chart", () => {
  it("re-reads the aggregate with the days the range toggle asked for", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() => expect(dashboardRequests()).toEqual(["/v1/dashboard?days=90"]));

    await userEvent.click(screen.getByRole("tab", { name: "30 days" }));
    await waitFor(() =>
      expect(dashboardRequests()).toContain("/v1/dashboard?days=30"),
    );

    await userEvent.click(screen.getByRole("tab", { name: "7 days" }));
    await waitFor(() => expect(dashboardRequests()).toContain("/v1/dashboard?days=7"));
  });

  it("says the window is empty instead of drawing a flat line at zero", async () => {
    installFetch({ dashboard: { ...dashboard, series: FLAT_SERIES } });
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    expect(await screen.findByText("Nothing posted in this range.")).toBeTruthy();
    expect(document.querySelector("[data-slot='chart']")).toBeNull();
  });

  it("draws the series when something was posted", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await waitFor(() =>
      expect(document.querySelector("[data-slot='chart']")).not.toBeNull(),
    );
    expect(screen.queryByText("Nothing posted in this range.")).toBeNull();
  });
});

describe("DashboardScreen — recent entries", () => {
  it("renders the first page of the entries read, unfiltered", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    expect(await screen.findByText("ENT-0042")).toBeTruthy();
    expect(screen.getByText("ENT-0041")).toBeTruthy();
    expect(requested).toContain("/v1/finance/entries");
    // No filter controls and no pager: the entries screen owns those.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("reuses the entries status chips and money formatting", async () => {
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    expect(await screen.findByText("Posted")).toBeTruthy();
    expect(screen.getByText("Awaiting review")).toBeTruthy();
    expect(screen.getByText("Fuel")).toBeTruthy();
  });

  it("opens the entry detail route from the entry number", async () => {
    installFetch();
    const router = await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    // The entry number is the primary cell, so it is the row's one trigger.
    await userEvent.click(await screen.findByRole("button", { name: "ENT-0042" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/finance/entries/11111111-1111-4111-8111-111111111111",
      ),
    );
  });

  it("leaves the rest of the recent row inert, as on the entries screen", async () => {
    installFetch();
    const router = await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    await userEvent.click(await screen.findByText("Fuel"));

    expect(router.state.location.pathname).toBe("/");
  });
});

describe("DashboardScreen — i18n", () => {
  it("renders in French with no English left behind", async () => {
    await i18n.changeLanguage("fr-CM");
    installFetch();
    await renderHome(membership("DIRECTOR", ["CORE", "ASSETS", "FINANCE"]));

    expect(await screen.findByRole("heading", { name: "Accueil" })).toBeTruthy();
    expect(screen.getByText("Approbations en attente")).toBeTruthy();
    expect(screen.getByText("Dépenses et recettes")).toBeTruthy();
    expect(screen.getByText("Écritures récentes")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "30 jours" })).toBeTruthy();
    expect(screen.queryByText("Pending approvals")).toBeNull();
  });
});
