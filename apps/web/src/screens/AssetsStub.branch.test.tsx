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

function stubFetch() {
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
        return new Response(JSON.stringify(PAGE), { status: 200 });
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

    await waitFor(() => expect(lastQuery(listed).get("branchId")).toBe(DLA.id));
    // The tiles count inside the same narrowing the table shows.
    await waitFor(() => expect(lastQuery(summarized).get("branchId")).toBe(DLA.id));
  });

  it("sends no branchId while the switcher is on all my branches", async () => {
    const { listed } = stubFetch();

    renderScreen();
    await screen.findByText("AST-001");

    expect(lastQuery(listed).get("branchId")).toBeNull();
  });

  it("lets the table's own branch filter override the current branch", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const { listed } = stubFetch();

    renderScreen();
    await screen.findByText("AST-001");
    await waitFor(() => expect(lastQuery(listed).get("branchId")).toBe(DLA.id));

    await userEvent.click(screen.getByRole("combobox", { name: "Agence" }));
    await userEvent.click(await screen.findByRole("option", { name: "Yaoundé" }));

    await waitFor(() => expect(lastQuery(listed).get("branchId")).toBe(YDE.id));
  });
});
