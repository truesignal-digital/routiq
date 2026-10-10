// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { applyNavigate, currentSearch, useTestSearch } from "../test-router.js";
import { ActivitiesScreen } from "./ActivitiesScreen.js";
import { AssetsStub } from "./AssetsStub.js";
import { MaintenanceScreen } from "./MaintenanceScreen.js";

/**
 * The Module list archetype (#302, docs/design/consistency/pages.html#list):
 * every module list opens on server-counted tiles above its table, and a tile
 * filters the table through the URL. A new module list joins the table below.
 */
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => applyNavigate,
  useSearch: () => useTestSearch(),
  useParams: () => ({}),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
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

/** Canned bodies by path prefix, longest first so `/v1/assets/summary` wins over `/v1/assets`. */
const BODIES: [string, unknown][] = [
  ["/v1/assets/summary", { total: 3, inService: 2, attention: 1 }],
  ["/v1/reference/asset-registration", { assetClasses: [], branches: [] }],
  ["/v1/activities/summary", {
    week: { from: "2026-10-05", to: "2026-10-11" },
    thisWeek: 3,
    open: 2,
    incomplete: 1,
    weekKm: 224,
  }],
  ["/v1/maintenance/summary", {
    openIssues: 2,
    openSafetyCritical: 1,
    grounded: 1,
    approvedWorkOrders: 1,
    averageRepairDays: 3.5,
    repairsCounted: 4,
    repairWindowDays: 90,
  }],
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

const LISTS: {
  name: string;
  Screen: ComponentType;
  tile: string;
  /** The list read the tile's filter reaches, and the parameter it adds. */
  list: string;
  param: [string, string];
  search: Record<string, string>;
}[] = [
  {
    name: "Trucks",
    Screen: AssetsStub,
    tile: "Attention",
    list: "/v1/assets?",
    param: ["attention", "true"],
    search: { status: "ATTENTION" },
  },
  {
    name: "Trips",
    Screen: ActivitiesScreen,
    tile: "Incomplete data",
    list: "/v1/activities?",
    param: ["completeness", "COMPLETE_WITH_EXCEPTIONS"],
    search: { completeness: "COMPLETE_WITH_EXCEPTIONS" },
  },
  {
    name: "Maintenance",
    Screen: MaintenanceScreen,
    tile: "Work orders in progress",
    list: "/v1/work-orders?",
    param: ["status", "APPROVED"],
    search: { status: "APPROVED" },
  },
];

describe("module list archetype", () => {
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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it.each(LISTS)("$name opens on the metric strip, above the table", async ({ Screen }) => {
    const { container } = renderList(Screen);

    await waitFor(() =>
      expect(container.querySelector("[data-slot=metric-strip][data-state=ready]")).toBeTruthy(),
    );
    const strip = container.querySelector("[data-slot=metric-strip]")!;
    await waitFor(() => expect(container.querySelector("[data-slot=data-table]")).toBeTruthy());
    const table = container.querySelector("[data-slot=data-table]");
    expect(strip.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The numbers come from a summary read; each list holds a single row.
    expect(requested.some((href) => href.includes("/summary"))).toBe(true);
  });

  it.each(LISTS)(
    "$name: a tile filters the table through the URL",
    async ({ Screen, tile, list, param, search }) => {
      const user = userEvent.setup();
      renderList(Screen);

      const button = await screen.findByRole("button", { name: tile });
      expect(button.getAttribute("aria-pressed")).toBe("false");
      await user.click(button);

      expect(currentSearch()).toMatchObject(search);
      await waitFor(() => {
        const last = requested.filter((href) => href.startsWith(list)).at(-1);
        expect(new URLSearchParams(last?.split("?")[1]).get(param[0])).toBe(param[1]);
      });
      expect(
        screen.getByRole("button", { name: tile }).getAttribute("aria-pressed"),
      ).toBe("true");
    },
  );

  // Finance entries and Approvals open on GET /v1/finance/summary tiles built
  // in #516 (#314) on this same MetricStrip; their rows join LISTS once it is
  // in develop.
  it.todo("Finance entries and Approvals open on the metric strip — delivered by #516 (#314)");
});
