// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { AssetsStub } from "./AssetsStub.js";

function item(assetCode: string, manufacturer: string) {
  return {
    id: `id-${assetCode}`,
    assetCode,
    registrationNumber: null,
    manufacturer,
    model: "Actros",
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 1,
    category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
    branch: { code: "DLA", name: "Douala" },
  };
}

/**
 * Records the `/v1/assets` URLs the screen asks for, one canned body per call.
 * Asset cards also fetch reference data; those requests are answered with an
 * empty body and kept out of the record.
 */
function stubFetch(bodies: unknown[]) {
  const requested: string[] = [];
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (!href.startsWith("/v1/assets")) {
        return new Response("{}", { status: 200 });
      }
      requested.push(href);
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return requested;
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
    enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
  };
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeCtx.Provider value={me}>
        <AssetsStub />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

function lastQuery(requested: string[]) {
  return new URLSearchParams(requested[requested.length - 1]!.split("?")[1]);
}

describe("AssetsStub server-side filtering", () => {
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
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("renders the page the server returned", async () => {
    stubFetch([{ items: [item("AST-001", "Mercedes")], nextCursor: null }]);

    renderScreen();

    expect(await screen.findByText("AST-001")).toBeDefined();
  });

  it("sends the search box to the server instead of filtering locally", async () => {
    const requested = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /rechercher/i }),
      "scania",
    );

    await waitFor(() => expect(lastQuery(requested).get("search")).toBe("scania"));
  });

  it("maps the ATTENTION tab onto its three lifecycle statuses", async () => {
    const requested = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.click(screen.getByRole("button", { name: /à surveiller/i }));

    await waitFor(() =>
      expect(lastQuery(requested).getAll("status")).toEqual([
        "UNDER_MAINTENANCE",
        "RETIRED",
        "WRITTEN_OFF",
      ]),
    );
  });

  it("pages with the cursor and appends the next page", async () => {
    const requested = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: "page-2" },
      { items: [item("AST-002", "Scania")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.click(screen.getByRole("button", { name: /charger plus/i }));

    expect(await screen.findByText("AST-002")).toBeDefined();
    expect(lastQuery(requested).get("cursor")).toBe("page-2");
    expect(screen.queryByRole("button", { name: /charger plus/i })).toBeNull();
  });

  it("offers a reset when a narrowed list comes back empty", async () => {
    const requested = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
      { items: [], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /rechercher/i }),
      "zzz",
    );

    await waitFor(() => expect(lastQuery(requested).get("search")).toBe("zzz"));
    expect(
      await screen.findByRole("button", { name: /effacer les filtres/i }),
    ).toBeDefined();
  });
});
