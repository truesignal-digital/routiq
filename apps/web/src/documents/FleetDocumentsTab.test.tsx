// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@routiq/contracts";
import { i18n } from "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { applyNavigate, resetSearch, useTestSearch } from "../test-router.js";
import { FleetDocumentsTab } from "./FleetDocumentsTab.js";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => applyNavigate,
  useSearch: () => useTestSearch(),
}));

const scope = { ambientBranch: "IGNORED", branchIds: "ALL" };
const TODO = {
  businessDate: "2026-10-09",
  scope,
  totalCount: 1,
  rows: [{
    code: "DOCUMENT_EXPIRED",
    severity: "CRITICAL",
    link: { kind: "document", id: "d1", number: null },
    asset: { id: "a1", assetCode: "VH001" },
    branchId: null,
    since: "2026-10-01T00:00:00.000Z",
    params: { expiresAt: "2026-10-01", daysLeft: -8, documentTypeLabelFr: "Assurance", documentTypeLabelEn: "Insurance" },
  }],
};
const COMING_UP = {
  businessDate: "2026-10-09",
  windowDays: 30,
  scope,
  totalCount: 1,
  notCounted: [],
  rows: [{
    code: "DOCUMENT_DUE",
    link: { kind: "document", id: "d5", number: null },
    asset: { id: "a5", assetCode: "VH005" },
    branchId: null,
    dueDate: "2026-10-15",
    params: { daysLeft: 6, documentTypeLabelFr: "Visite technique", documentTypeLabelEn: "Roadworthiness test" },
  }],
};

let requested: string[] = [];

function renderAs(role: Role) {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      requested.push(String(url));
      return new Response(JSON.stringify(String(url).startsWith("/v1/todo") ? TODO : COMING_UP), { status: 200 });
    }),
  );
  const me: MeContext = {
    workspaceId: "ws",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    role,
    branchScope: "ALL",
    enabledModules: ["CORE", "ASSETS", "DOCUMENTS"],
    enabledPresets: ["TRUCKING"],
    timezone: "Africa/Douala",
    displayName: "Emilienne Ngo",
    workspaceName: "Transports Ngwa",
  };
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MeCtx.Provider value={me}>
        <FleetDocumentsTab />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

describe("Trucks › Documents (#665)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterAll(async () => {
    await i18n.changeLanguage("fr-CM");
  });
  beforeEach(() => {
    resetSearch();
    sessionStore.save({ username: "ada", workspaceSlug: "ws-1", token: "tok", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("lists the expired papers, then the papers due, from the reads the Overview counts", async () => {
    renderAs("ADMIN");
    expect(await screen.findByText("Expired 8 days ago")).toBeTruthy();
    expect(screen.getByText("Due in 6 days")).toBeTruthy();
    expect(requested.some((href) => href === "/v1/coming-up?days=30")).toBe(true);
  });

  it("narrows to the filter the Overview's tile put in the address", async () => {
    resetSearch({ expiry: "DUE_30" });
    renderAs("ADMIN");
    expect(await screen.findByText("Due in 6 days")).toBeTruthy();
    expect(screen.queryByText("Expired 8 days ago")).toBeNull();
  });

  it("is not a tab for the cashier, and reads nothing for them", () => {
    renderAs("CASHIER");
    expect(screen.queryByText("Due in 6 days")).toBeNull();
    expect(requested).toEqual([]);
  });
});
