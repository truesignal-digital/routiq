// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { applyNavigate, resetSearch, useTestSearch } from "../test-router.js";
import { TripsOverview } from "../activities/TripsOverview.js";
import { TrucksOverview } from "../assets/TrucksOverview.js";
import { MaintenanceOverview } from "../maintenance/MaintenanceOverview.js";
import { ActivitiesScreen } from "./ActivitiesScreen.js";
import { AssetsStub } from "./AssetsStub.js";
import { MaintenanceScreen } from "./MaintenanceScreen.js";

/**
 * The Module page archetype (#665, dashboards.html#rule): every module page
 * opens on an Overview of server-counted tiles, and a tile opens the list tab
 * with its filter in the URL, which the list hands to its read. A new module
 * page joins the table below.
 */
const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => applyNavigate,
  useSearch: () => useTestSearch(),
  useParams: () => ({}),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: route.pathname } }),
  useMatches: ({ select }: { select: (matches: Array<{ routeId: string }>) => unknown }) =>
    select([{ routeId: `/app${route.pathname}` }]),
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={search === undefined ? to : `${to}?${new URLSearchParams(search).toString()}`} {...props}>
      {children}
    </a>
  ),
}));

const EMPTY_PAGE = { items: [], nextCursor: null };
const page = (item: unknown) => ({ items: [item], nextCursor: null });

/** One row per list, so each table renders rather than its empty state. */
const ASSET = {
  id: "id-VH001",
  assetCode: "VH001",
  registrationNumber: null,
  manufacturer: "Renault",
  model: "Kerax",
  lifecycleStatus: "IN_SERVICE",
  rowVersion: 1,
  category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
  branch: { code: "DLA", name: "Douala" },
};
const ACTIVITY = {
  id: "11111111-1111-4111-8111-111111111111",
  activityNumber: "DLA-2026-00042",
  activityType: { code: "HAULAGE_JOB", labelFr: "Job de halage", labelEn: "Haulage job" },
  status: "OPEN",
  completeness: null,
  completenessCodes: [],
  startedAt: "2026-10-06T06:10:00.000Z",
  endedAt: null,
  customerName: null,
  clientReference: null,
  branchId: "22222222-2222-4222-8222-222222222222",
  primaryAssetCode: "VH001",
  legCount: 0,
  crewCount: 0,
};
const WORK_ORDER = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "APPROVED",
  description: "Plaquettes de frein",
  asset: { id: "id-VH001", assetCode: "VH001", registrationNumber: null },
  branch: { id: "22222222-2222-4222-8222-222222222222", code: "DLA", name: "Douala" },
  expectedCostMinor: null,
  actualCostMinor: null,
  declaredCostMinor: null,
  costOutcome: null,
  costToCome: null,
  currency: "XAF",
  issue: null,
  createdAt: "2026-10-06T08:00:00.000Z",
  completedAt: null,
  cancelledAt: null,
  rejectedAt: null,
  rowVersion: 1,
  createdBy: { principalId: null, displayName: null, scope: "WORKSPACE" },
  completedBy: null,
};

const WEEKS = Array.from({ length: 12 }, (_, index) => ({
  from: `2026-07-${String(20 + index).padStart(2, "0")}`,
  to: `2026-07-${String(20 + index).padStart(2, "0")}`,
  started: index,
  closed: index,
}));

/** Canned bodies by path prefix, longest first so `/v1/assets/summary` wins over `/v1/assets`. */
const BODIES: [string, unknown][] = [
  ["/v1/assets/summary", { total: 3, inService: 2, attention: 1 }],
  ["/v1/assets/overview", {
    total: 3,
    canDrive: 2,
    grounded: { count: 1, first: { assetId: "id-VH002", assetCode: "VH002", since: "2026-10-01T08:00:00.000Z" } },
    idle: { count: 0, days: 5, first: null },
  }],
  ["/v1/reference/asset-registration", { assetClasses: [], branches: [] }],
  ["/v1/activities/summary", {
    week: { from: "2026-10-05", to: "2026-10-11" },
    thisWeek: 3,
    weekClosed: 1,
    open: 2,
    oldestOpen: null,
    incomplete: 1,
    closedMissing: { fuel: 1, km: 0 },
    weekKm: 224,
    weeks: WEEKS,
  }],
  ["/v1/maintenance/summary", {
    openIssues: 2,
    openSafetyCritical: 1,
    grounded: 1,
    firstGrounded: null,
    approvedWorkOrders: 1,
    openWorkOrders: 2,
    waitingApproval: 1,
    waitingCompletion: 0,
    averageRepairDays: 3.5,
    repairsCounted: 4,
    repairWindowDays: 90,
    repairCost: null,
  }],
  ["/v1/coming-up", { businessDate: "2026-10-10", windowDays: 30, scope: { ambientBranch: "IGNORED", branchIds: "ALL" }, rows: [], totalCount: 0, notCounted: [] }],
  ["/v1/todo", { businessDate: "2026-10-10", scope: { ambientBranch: "IGNORED", branchIds: "ALL" }, rows: [], totalCount: 0 }],
  ["/v1/categories", []],
  ["/v1/assets", page(ASSET)],
  ["/v1/activities", page(ACTIVITY)],
  ["/v1/work-orders", page(WORK_ORDER)],
  ["/v1/issues", EMPTY_PAGE],
];

let requested: string[] = [];

function stubFetch() {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      requested.push(href);
      const match = BODIES.find(([prefix]) => href.startsWith(prefix));
      return new Response(JSON.stringify(match?.[1] ?? {}), { status: 200 });
    }),
  );
}

function renderList(Screen: ComponentType) {
  const me: MeContext = {
    workspaceId: "ws",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    role: "DIRECTOR",
    branchScope: "ALL",
    enabledModules: ["CORE", "ASSETS", "ACTIVITIES", "MAINTENANCE"],
    enabledPresets: ["TRUCKING"],
    timezone: "Africa/Douala",
    displayName: "Emilienne Ngo",
    workspaceName: "Transports Ngwa",
  };
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeCtx.Provider value={me}>
        <Screen />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

const PAGES: {
  name: string;
  Overview: ComponentType;
  tile: string;
  /** Where the tile leads: the list tab, filtered. */
  href: string;
  List: ComponentType;
  listPath: string;
  search: Record<string, string>;
  /** The list read the filter reaches, and the parameter it adds. */
  list: string;
  param: [string, string];
}[] = [
  {
    name: "Trucks",
    Overview: TrucksOverview,
    tile: "Attention",
    href: "/assets/list?status=ATTENTION",
    List: AssetsStub,
    listPath: "/assets/list",
    search: { status: "ATTENTION" },
    list: "/v1/assets?",
    param: ["attention", "true"],
  },
  {
    name: "Trips",
    Overview: TripsOverview,
    tile: "Closed with missing data",
    href: "/activities/list?completeness=COMPLETE_WITH_EXCEPTIONS",
    List: ActivitiesScreen,
    listPath: "/activities/list",
    search: { completeness: "COMPLETE_WITH_EXCEPTIONS" },
    list: "/v1/activities?",
    param: ["completeness", "COMPLETE_WITH_EXCEPTIONS"],
  },
  {
    name: "Maintenance",
    Overview: MaintenanceOverview,
    tile: "Work orders open",
    href: "/maintenance/work-orders?only=open",
    List: MaintenanceScreen,
    listPath: "/maintenance/work-orders",
    search: { only: "open" },
    list: "/v1/work-orders?",
    param: ["open", "true"],
  },
];

describe("module page archetype", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  afterAll(async () => {
    await i18n.changeLanguage("fr-CM");
  });

  beforeEach(() => {
    sessionStore.save({
      username: "ada",
      workspaceSlug: "ws-1",
      token: "tok",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    stubFetch();
    resetSearch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it.each(PAGES)("$name opens on an Overview whose tiles a summary read counts", async ({ Overview }) => {
    const { container } = renderList(Overview);
    await waitFor(() =>
      expect(container.querySelector("[data-slot=metric-strip][data-state=ready]")).toBeTruthy(),
    );
    expect(requested.some((href) => /\/(summary|overview)/.test(href))).toBe(true);
  });

  it.each(PAGES)("$name: a tile opens the list tab filtered", async ({ Overview, tile, href }) => {
    renderList(Overview);
    const link = await screen.findByRole("link", { name: tile });
    expect(link.getAttribute("href")).toBe(href);
  });

  it.each(PAGES)(
    "$name: the list tab hands the filter in its address to its read",
    async ({ List, listPath, search, list, param }) => {
      route.pathname = listPath;
      resetSearch(search);
      const { container } = renderList(List);
      await waitFor(() => expect(container.querySelector("[data-slot=data-table]")).toBeTruthy());
      await waitFor(() => {
        const last = requested.filter((href) => href.startsWith(list)).at(-1);
        expect(new URLSearchParams(last?.split("?")[1]).get(param[0])).toBe(param[1]);
      });
      // The tiles live on the Overview; the list starts with its search and filters.
      expect(container.querySelector("[data-slot=metric-strip]")).toBeNull();
    },
  );
});
