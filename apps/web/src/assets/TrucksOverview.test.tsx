// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetOverview, ModuleCode, Role } from "@routiq/contracts";
import { i18n } from "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { TrucksOverview, truckSummaryDetails } from "./TrucksOverview.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search, children, ...props }: { to: string; search?: Record<string, string>; children?: ReactNode }) => (
    <a href={search === undefined ? to : `${to}?${new URLSearchParams(search).toString()}`} {...props}>
      {children}
    </a>
  ),
}));

const scope = { ambientBranch: "IGNORED", branchIds: "ALL" };

const OVERVIEW = {
  total: 12,
  canDrive: 10,
  grounded: { count: 1, first: { assetId: "a3", assetCode: "VH003", since: "2026-10-01T08:00:00.000Z" } },
  idle: { count: 1, days: 5, first: { assetId: "a12", assetCode: "VH012", lastTripAt: null } },
};

const MONEY = {
  currency: "XAF",
  range: "THIS_MONTH",
  branchId: null,
  view: "PROFIT",
  period: { from: "2026-10-01", to: "2026-10-09", revenueMinor: 900000, expenseMinor: 500000, profitMinor: 400000 },
  comparison: { from: "2026-09-01", to: "2026-09-09", revenueMinor: 0, expenseMinor: 0, profitMinor: 0 },
  series: [],
  expensesByCategory: [],
  vehicles: [
    { assetId: "a1", assetCode: "VH001", registrationNumber: null, branchId: "b", tripsClosed: 3, distanceKm: 1200, tripsWithoutKm: 0, revenueMinor: 600000, expenseMinor: 200000, profitMinor: 400000 },
    { assetId: "a2", assetCode: "VH002", registrationNumber: null, branchId: "b", tripsClosed: 1, distanceKm: null, tripsWithoutKm: 1, revenueMinor: 0, expenseMinor: 86000, profitMinor: -86000 },
  ],
  branches: [],
  companyProfit: null,
  counted: { postedEntries: 4, closedTrips: 4 },
  notCounted: { waitingApproval: { count: 0, amountMinor: 0 }, missingReceipt: { count: 0, amountMinor: 0 }, openTrips: 0, otherCurrencyEntries: 0 },
};

const BODIES: [string, unknown][] = [
  ["/v1/assets/overview", OVERVIEW],
  ["/v1/assets/summary", { total: 12, inService: 11, attention: 2 }],
  ["/v1/coming-up", {
    businessDate: "2026-10-09",
    windowDays: 30,
    scope,
    rows: [{
      code: "DOCUMENT_DUE",
      link: { kind: "document", id: "d5", number: null },
      asset: { id: "a5", assetCode: "VH005" },
      branchId: null,
      dueDate: "2026-10-15",
      params: { daysLeft: 6, documentTypeLabelFr: "Visite technique", documentTypeLabelEn: "Roadworthiness test" },
    }],
    totalCount: 1,
    notCounted: ["SERVICE_DUE_BY_KM"],
  }],
  ["/v1/todo", { businessDate: "2026-10-09", scope, rows: [], totalCount: 0 }],
  ["/v1/finance/overview", MONEY],
];

let requested: string[] = [];

function renderAs(role: Role, enabledModules: ModuleCode[] = ["CORE", "ASSETS", "DOCUMENTS", "FINANCE", "ACTIVITIES", "MAINTENANCE"], overview: unknown = OVERVIEW) {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      requested.push(href);
      const body = href.startsWith("/v1/assets/overview") ? overview : BODIES.find(([prefix]) => href.startsWith(prefix))?.[1];
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    }),
  );
  const me: MeContext = {
    workspaceId: "ws",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    role,
    branchScope: "ALL",
    enabledModules,
    enabledPresets: ["TRUCKING"],
    timezone: "Africa/Douala",
    displayName: "Emilienne Ngo",
    workspaceName: "Transports Ngwa",
  };
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MeCtx.Provider value={me}>
        <TrucksOverview />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

const linkOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("Trucks › Overview (#665)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterAll(async () => {
    await i18n.changeLanguage("fr-CM");
  });
  beforeEach(() => {
    sessionStore.save({ username: "ada", workspaceSlug: "ws-1", token: "tok", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("opens each tile's tab already filtered", async () => {
    renderAs("ADMIN");
    await screen.findByText("of 12");
    expect(linkOf("Can drive")).toBe("/assets/list?availability=CAN_DRIVE");
    expect(linkOf("Grounded")).toBe("/assets/list?availability=GROUNDED");
    expect(linkOf("Attention")).toBe("/assets/list?status=ATTENTION");
    expect(linkOf("Documents due ≤ 30 days")).toBe("/assets/documents?expiry=DUE_30");
    expect(linkOf("Idle 5+ days")).toBe("/assets/list?availability=IDLE");
    expect(await screen.findByText("First: VH005 · 10/15/26")).toBeTruthy();
    expect(screen.getByText("VH012 · never")).toBeTruthy();
  });

  it("lists the papers due with one button each, and says services by km are not counted", async () => {
    renderAs("ADMIN");
    expect(await screen.findByText("VH005 · Roadworthiness test")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Renew" }).getAttribute("href")).toBe("/assets/a5/documents?panel=document%3Ad5");
    expect(screen.getByText(/Services by km are not counted/)).toBeTruthy();
  });

  it("shows profit by truck, losses first and in words, to the roles that read profit", async () => {
    const { container } = renderAs("ADMIN");
    await waitFor(() => expect(container.querySelectorAll("[data-slot=profit-bars-row]")).toHaveLength(2));
    const rows = [...container.querySelectorAll("[data-slot=profit-bars-row]")].map((row) => row.textContent);
    expect(rows[0]).toContain("VH002");
    expect(rows[0]).toMatch(/Loss/);
    expect(rows[1]).toMatch(/Profit/);
  });

  it("never shows a technician revenue or profit, and never asks for it", async () => {
    renderAs("TECHNICIAN");
    await screen.findByText("of 12");
    expect(screen.queryByText(/profit|revenue/i)).toBeNull();
    expect(requested.some((href) => href.startsWith("/v1/finance"))).toBe(false);
  });

  it("drops the tiles of a module that is off instead of reading zero", async () => {
    renderAs("ADMIN", ["CORE", "ASSETS"], { ...OVERVIEW, grounded: null, idle: null });
    await screen.findByText("of 12");
    expect(screen.queryByRole("link", { name: "Grounded" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Idle 5+ days" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Documents due ≤ 30 days" })).toBeNull();
    expect(requested.some((href) => href.startsWith("/v1/coming-up"))).toBe(false);
  });

  it("opens with the summary notice on a Monday, the fleet in one sentence (#667)", async () => {
    localStorage.clear();
    renderAs("ADMIN", undefined, {
      ...OVERVIEW,
      notice: { today: "2026-10-05", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: "MONDAY", changes: [] },
    });
    const region = await screen.findByRole("region", { name: "Summary" });
    expect(region.textContent).toMatch(/Can drive today: 10 of 12 (vehicles|trucks)\./);
    expect(region.querySelector("[data-summary=open]")?.textContent).toBe("In service and not grounded today.");
    screen.getByRole("button", { name: "Close the summary" }).click();
    await screen.findByRole("button", { name: "Show summary" });
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  });

  it("names a grounding once: as the big change, not again as the longest off the road (#667)", () => {
    const notice = { today: "2026-10-09", schedule: "MONDAY_AND_MONTH_START" as const, scheduledOn: "2026-10-05", scheduledToday: null, changes: [] };
    const t = i18n.getFixedT("en");
    const grounded = { ...OVERVIEW, notice } as AssetOverview;
    expect(truckSummaryDetails(grounded, t, "en")).toHaveLength(1);
    const changed = {
      ...grounded,
      notice: { ...notice, changes: [{ kind: "VEHICLE_GROUNDED" as const, key: "G", assetId: "a3", assetCode: "VH003", since: "2026-10-07T08:00:00.000Z" }] },
    };
    expect(truckSummaryDetails(changed, t, "en")).toEqual([]);
  });
});
