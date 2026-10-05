// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { AssetsStub } from "./AssetsStub.js";

// A real Link needs a router around it; the screen renders bare here.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}));

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

const SUMMARY = { total: 6, inService: 4, attention: 2 };

const REFERENCE = {
  assetClasses: [{ code: "BUS", labelFr: "Autobus", labelEn: "Bus" }],
  branches: [{ id: "branch-yde", code: "YDE", name: "Yaoundé" }],
};

/**
 * Records the `/v1/assets` URLs the screen asks for, one canned body per call.
 * The summary and reference reads answer from their own fixtures — `/v1/assets`
 * is a prefix of `/v1/assets/summary`, so they are matched first.
 */
function stubFetch(bodies: unknown[]) {
  const requested: string[] = [];
  const summaryRequested: string[] = [];
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.startsWith("/v1/assets/summary")) {
        summaryRequested.push(href);
        return new Response(JSON.stringify(SUMMARY), { status: 200 });
      }
      if (href.startsWith("/v1/reference/asset-registration")) {
        return new Response(JSON.stringify(REFERENCE), { status: 200 });
      }
      if (!href.startsWith("/v1/assets")) {
        return new Response("{}", { status: 200 });
      }
      requested.push(href);
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return { requested, summaryRequested };
}

function renderScreen(
  role: MeContext["role"] = "ADMIN",
  enabledModules: MeContext["enabledModules"] = ["CORE", "ASSETS"],
) {
  const me: MeContext = {
    workspaceId: "ws",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    role,
    branchScope: "ALL",
    enabledModules,
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

describe("assets explorer server-side filtering", () => {
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
    const { requested } = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /code, plaque/i }),
      "scania",
    );

    await waitFor(() => expect(lastQuery(requested).get("search")).toBe("scania"));
  });

  it("asks the server for the Attention tile's set, not three lifecycle statuses", async () => {
    const { requested } = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.click(screen.getByRole("combobox", { name: "Statut" }));
    await userEvent.click(await screen.findByRole("option", { name: "À surveiller" }));

    await waitFor(() => expect(lastQuery(requested).get("attention")).toBe("true"));
    expect(lastQuery(requested).getAll("status")).toEqual([]);
  });

  it("narrows by class on the server", async () => {
    const { requested } = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.click(screen.getByRole("combobox", { name: "Classe" }));
    await userEvent.click(await screen.findByRole("option", { name: "Autobus" }));
    await waitFor(() => expect(lastQuery(requested).get("category")).toBe("BUS"));

    // Branch is not one of them: it comes from the shell's switcher, through
    // the branch-scoped read (see AssetsStub.branch.test.tsx).
    expect(screen.queryByRole("combobox", { name: "Agence" })).toBeNull();
  });

  it("sorts through the server, since the cursor is keyed on the order", async () => {
    const { requested } = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    // The default is the read's own: asset code ascending.
    expect(lastQuery(requested).get("sort")).toBe("assetCode:asc");

    await userEvent.click(screen.getByRole("button", { name: /actif/i }));

    await waitFor(() =>
      expect(lastQuery(requested).get("sort")).toBe("assetCode:desc"),
    );
  });

  it("pages with the cursor and steps onto the page it fetched", async () => {
    const { requested } = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: "page-2" },
      { items: [item("AST-002", "Scania")], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.click(
      screen.getByRole("button", { name: /page suivante/i }),
    );

    expect(await screen.findByText("AST-002")).toBeDefined();
    expect(lastQuery(requested).get("cursor")).toBe("page-2");
  });

  it("offers a way back when a narrowed list comes back empty", async () => {
    const { requested } = stubFetch([
      { items: [item("AST-001", "Mercedes")], nextCursor: null },
      { items: [], nextCursor: null },
    ]);
    renderScreen();
    await screen.findByText("AST-001");

    await userEvent.type(
      screen.getByRole("searchbox", { name: /code, plaque/i }),
      "zzz",
    );

    await waitFor(() => expect(lastQuery(requested).get("search")).toBe("zzz"));
    expect(await screen.findByText(/aucun actif trouvé/i)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /effacer les filtres/i }),
    ).toBeDefined();
  });

  describe("metric strip", () => {
    it("shows the counts the server computed, not the rows on screen", async () => {
      const { summaryRequested } = stubFetch([
        { items: [item("AST-001", "Mercedes")], nextCursor: "page-2" },
      ]);
      renderScreen();
      await screen.findByText("AST-001");

      const values = await waitFor(() => {
        const nodes = document.querySelectorAll("[data-slot=metric-value]");
        expect(nodes).toHaveLength(3);
        return [...nodes].map((node) => node.textContent);
      });

      // One row is loaded; the tiles still report the whole fleet.
      expect(values).toEqual(["6", "4", "2"]);
      expect(summaryRequested).toHaveLength(1);
    });

    it("says the Attention count covers grounded vehicles only while MAINTENANCE is on", async () => {
      stubFetch([{ items: [item("AST-001", "Mercedes")], nextCursor: null }]);
      const { unmount } = renderScreen("ADMIN", ["CORE", "ASSETS", "MAINTENANCE"]);
      expect(
        await screen.findByText("Immobilisés, en maintenance, retirés ou réformés"),
      ).toBeDefined();
      unmount();

      renderScreen("ADMIN", ["CORE", "ASSETS"]);
      expect(await screen.findByText("En maintenance, retirés ou réformés")).toBeDefined();
      expect(
        screen.queryByText("Immobilisés, en maintenance, retirés ou réformés"),
      ).toBeNull();
    });

    it("asks the summary to narrow with the table, minus the status bucket", async () => {
      const { summaryRequested } = stubFetch([
        { items: [item("AST-001", "Mercedes")], nextCursor: null },
      ]);
      renderScreen();
      await screen.findByText("AST-001");

      await userEvent.click(screen.getByRole("combobox", { name: "Statut" }));
      await userEvent.click(
        await screen.findByRole("option", { name: "À surveiller" }),
      );
      await userEvent.type(
        screen.getByRole("searchbox", { name: /code, plaque/i }),
        "scania",
      );

      await waitFor(() =>
        expect(lastQuery(summaryRequested).get("search")).toBe("scania"),
      );
      expect(lastQuery(summaryRequested).getAll("status")).toEqual([]);
    });
  });

  describe("row actions", () => {
    it("opens the record and the documents screen from the row menu", async () => {
      stubFetch([{ items: [item("AST-001", "Mercedes")], nextCursor: null }]);
      renderScreen();
      await screen.findByText("AST-001");

      await userEvent.click(screen.getByRole("button", { name: "Actions" }));
      const menu = await screen.findByRole("menu");

      expect(within(menu).getByText("Ouvrir la fiche")).toBeDefined();
      // DOCUMENTS is off for this workspace, so the row offers no way in.
      expect(within(menu).queryByText("Documents")).toBeNull();
    });

    it("offers the asset's commands and opens one as a dialog", async () => {
      stubFetch([
        {
          items: [{ ...item("AST-001", "Mercedes"), lifecycleStatus: "REGISTERED" }],
          nextCursor: null,
        },
      ]);
      renderScreen();
      await screen.findByText("AST-001");

      await userEvent.click(screen.getByRole("button", { name: "Actions" }));
      const menu = await screen.findByRole("menu");
      expect(within(menu).getByText("Mettre en service")).toBeDefined();
      expect(within(menu).getByText("Affecter")).toBeDefined();

      await userEvent.click(within(menu).getByText("Mettre en service"));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Confirmer" })).toBeDefined();
    });

    it("offers a viewer no commands at all", async () => {
      stubFetch([{ items: [item("AST-001", "Mercedes")], nextCursor: null }]);
      renderScreen("EXECUTIVE_VIEWER");
      await screen.findByText("AST-001");

      await userEvent.click(screen.getByRole("button", { name: "Actions" }));
      const menu = await screen.findByRole("menu");

      expect(within(menu).queryByText("Affecter")).toBeNull();
      expect(within(menu).getByText("Ouvrir la fiche")).toBeDefined();
    });
  });
});
