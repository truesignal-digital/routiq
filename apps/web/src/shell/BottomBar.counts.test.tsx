// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ModuleCode, NavCountsResponse, Role } from "@routiq/contracts";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";

const session = {
  username: "ada",
  workspaceSlug: "transports-douala",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

vi.mock("../auth/store.js", () => ({
  sessionStore: { logout: vi.fn(), getActive: () => session, getToken: () => "token" },
  useActiveSession: () => session,
}));

const { BottomBar } = await import("./BottomBar.js");

const EVERY: ModuleCode[] = ["CORE", "ASSETS", "ACTIVITIES", "MAINTENANCE", "FINANCE", "DOCUMENTS"];

function membership(role: Role): MeContext {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    principalType: "HUMAN",
    membershipId: "33333333-3333-4333-8333-333333333333",
    role,
    branchScope: "ALL",
    enabledModules: EVERY,
    enabledPresets: ["TRUCKING"],
    displayName: "Emilienne Ngo",
    workspaceName: "Transports Ngwa",
  };
}

const fetchMock = vi.fn<typeof fetch>();

/** What the server answers; it alone decides which counts a role gets. */
function serverSays(body: NavCountsResponse) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
}

let client = new QueryClient();

async function renderBar(me: MeContext) {
  const root = createRootRoute({
    component: () => (
      <MeCtx.Provider value={me}>
        <SidebarProvider>
          <BottomBar />
          <Outlet />
        </SidebarProvider>
      </MeCtx.Provider>
    ),
  });
  const pages = ["/", "/assets", "/activities", "/maintenance", "/finance/entries"].map((p) =>
    createRoute({ getParentRoute: () => root, path: p, component: () => <div data-testid="page">{p}</div> }),
  );
  const router = createRouter({
    routeTree: root.addChildren(pages),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId("page");
  return within(screen.getByRole("navigation", { name: "Shortcuts" }));
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("bottom bar counts (#322)", () => {
  it("puts the sidebar's red count on the place, and says it in the place's description", async () => {
    serverSays({ moneyWaiting: 3, maintenanceNew: null });
    const bar = await renderBar(membership("FINANCE"));

    const money = bar.getByRole("link", { name: "Money" });
    await waitFor(() => expect(money.getAttribute("aria-describedby")).not.toBeNull());
    const description = document.getElementById(money.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("3 expenses waiting for your approval");

    const badge = document.querySelector("[data-bar-count='moneyWaiting']");
    expect(badge?.textContent).toBe("3");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.className).toContain("bg-destructive");
    expect(document.querySelectorAll("[data-bar-count]")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/v1/nav-counts");
  });

  it("puts the Maintenance count on the technician's Maintenance place", async () => {
    serverSays({ moneyWaiting: null, maintenanceNew: 2 });
    const bar = await renderBar(membership("TECHNICIAN"));

    const maintenance = bar.getByRole("link", { name: "Maintenance" });
    await waitFor(() => expect(maintenance.getAttribute("aria-describedby")).not.toBeNull());
    expect(document.getElementById(maintenance.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "2 new problems to handle",
    );
    expect(document.querySelector("[data-bar-count='maintenanceNew']")?.textContent).toBe("2");
  });

  it("shows nothing at zero", async () => {
    serverSays({ moneyWaiting: 0, maintenanceNew: 0 });
    const bar = await renderBar(membership("DIRECTOR"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(document.querySelector("[data-bar-count]")).toBeNull();
    expect(bar.getByRole("link", { name: "Money" }).getAttribute("aria-describedby")).toBeNull();
  });

  it.each<Role>(["DRIVER", "CASHIER"])("asks nothing and shows no count for %s", async (role) => {
    serverSays({ moneyWaiting: 5, maintenanceNew: 5 });
    const bar = await renderBar(membership(role));

    expect(bar.getAllByRole("link")).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-bar-count]")).toBeNull();
  });
});
