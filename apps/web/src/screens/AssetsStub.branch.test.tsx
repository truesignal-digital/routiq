// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { BranchProvider, branchStorageKey } from "../shell/branch-context.js";
import { AssetsStub } from "./AssetsStub.js";

// A real Link needs a router around it; the screen renders bare here.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const DLA = { id: "branch-dla", code: "DLA", name: "Douala" };
const YDE = { id: "branch-yde", code: "YDE", name: "Yaoundé" };

const REFERENCE = { assetClasses: [], branches: [DLA, YDE] };
const SUMMARY = { total: 1, inService: 1, attention: 0 };
const PAGE = {
  items: [
    {
      id: "asset-1",
      assetCode: "AST-001",
      registrationNumber: null,
      manufacturer: "Mercedes",
      model: "Actros",
      lifecycleStatus: "IN_SERVICE",
      rowVersion: 1,
      category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
      branch: { code: "DLA", name: "Douala" },
    },
  ],
  nextCursor: null,
};
const EMPTY_PAGE = { items: [], nextCursor: null };

function stubFetch(page: unknown = PAGE) {
  const listed: string[] = [];
  const summarized: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.startsWith("/v1/assets/summary")) {
        summarized.push(href);
        return new Response(JSON.stringify(SUMMARY), { status: 200 });
      }
      if (href.startsWith("/v1/reference/asset-registration")) {
        return new Response(JSON.stringify(REFERENCE), { status: 200 });
      }
      if (href.startsWith("/v1/assets")) {
        listed.push(href);
        return new Response(JSON.stringify(page), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return { listed, summarized };
}

function renderScreen() {
  const me: MeContext = {
    workspaceId: "ws",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    role: "ADMIN",
    branchScope: "ALL",
    enabledModules: ["CORE", "ASSETS"],
    enabledPresets: ["TRUCKING"],
  };
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeCtx.Provider value={me}>
        <BranchProvider>
          <AssetsStub />
        </BranchProvider>
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

function lastQuery(requested: string[]) {
  return new URLSearchParams(requested[requested.length - 1]!.split("?")[1]);
}

describe("assets explorer under the shell's current branch", () => {
  beforeEach(() => {
    sessionStore.save({
      username: "ada",
      workspaceSlug: "ws-1",
      token: "tok",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.removeItem(branchStorageKey("ws-1"));
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("narrows the list and the tiles to the current branch", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const { listed, summarized } = stubFetch();

    renderScreen();
    await screen.findByText("AST-001");

    // Neither call passes a branch: `useAssets` and `useAssetSummary` declare
    // themselves branch-scoped, and the shared layer injects it.
    await waitFor(() => expect(lastQuery(listed).get("branchId")).toBe(DLA.id));
    await waitFor(() => expect(lastQuery(summarized).get("branchId")).toBe(DLA.id));
  });

  it("sends no branchId while the switcher is on all my branches", async () => {
    const { listed } = stubFetch();

    renderScreen();
    await screen.findByText("AST-001");

    expect(lastQuery(listed).get("branchId")).toBeNull();
  });

  it("offers no branch filter of its own", async () => {
    const { listed } = stubFetch();

    renderScreen();
    await screen.findByText("AST-001");

    // Two controls over one scope could only contradict each other; the header
    // switcher is the single piece of state.
    expect(lastQuery(listed).get("branchId")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Agence" })).toBeNull();
  });

  it("says which agency the rows came from, and how many there are", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    stubFetch();

    renderScreen();
    await screen.findByText("AST-001");

    expect(await screen.findByText("Filtré : Douala — 1 résultat")).toBeTruthy();
  });

  it("does not pass a loaded page off as the branch's total", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    stubFetch({ ...PAGE, nextCursor: "opaque" });

    renderScreen();
    await screen.findByText("AST-001");

    // A cursor never learns how many rows are behind it (ADR-0003).
    expect(
      await screen.findByText("Filtré : Douala — au moins 1 résultat"),
    ).toBeTruthy();
  });

  it("shows no scope line while every agency is in view", async () => {
    stubFetch();

    renderScreen();
    await screen.findByText("AST-001");

    expect(document.querySelector("[data-slot='branch-scope-line']")).toBeNull();
  });

  it("calls an agency with no assets empty, not a workspace with no assets", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    stubFetch(EMPTY_PAGE);

    renderScreen();

    // The first-run state would claim the fleet is unregistered while it sits
    // in another agency.
    expect(
      await screen.findByText("Rien à afficher pour Douala"),
    ).toBeTruthy();
    expect(screen.queryByText("Enregistrez votre premier véhicule")).toBeNull();
  });

  it("offers the way back to every agency from the empty state", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const { listed } = stubFetch(EMPTY_PAGE);

    renderScreen();
    await screen.findByText("Rien à afficher pour Douala");

    await userEvent.click(
      screen.getByRole("button", { name: "Voir toutes mes agences" }),
    );

    await waitFor(() => expect(lastQuery(listed).get("branchId")).toBeNull());
  });

  it("keeps the first-run state for a workspace with no assets at all", async () => {
    stubFetch(EMPTY_PAGE);

    renderScreen();

    expect(
      await screen.findByText("Enregistrez votre premier véhicule"),
    ).toBeTruthy();
  });
});
