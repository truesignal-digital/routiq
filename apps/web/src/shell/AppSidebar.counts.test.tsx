// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import {
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

const { AppSidebar } = await import("./AppSidebar.js");

const EVERY: ModuleCode[] = ["CORE", "ASSETS", "ACTIVITIES", "MAINTENANCE", "FINANCE", "DOCUMENTS"];

function membership(role: Role, enabledModules: ModuleCode[] = EVERY): MeContext {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    principalType: "HUMAN",
    membershipId: "33333333-3333-4333-8333-333333333333",
    role,
    branchScope: "ALL",
    enabledModules,
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

async function renderSidebar(me: MeContext, open = true) {
  const rootRoute = createRootRoute({
    component: () => (
      <MeCtx.Provider value={me}>
        <SidebarProvider defaultOpen={open}>
          <AppSidebar />
        </SidebarProvider>
      </MeCtx.Provider>
    ),
  });
  const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([home]),
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
  await screen.findByRole("navigation", { name: "Navigation" });
}

function nav() {
  return within(screen.getByRole("navigation", { name: "Navigation" }));
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

describe("navigation counts (#322)", () => {
  it("shows Money's waiting approvals as a link into the waiting view, from the server", async () => {
    serverSays({ moneyWaiting: 3, maintenanceNew: null });
    await renderSidebar(membership("FINANCE"));

    const count = await nav().findByRole("link", { name: "3 entries waiting for your approval" });
    expect(count.textContent).toBe("3");
    expect(count.getAttribute("href")).toBe("/finance/approvals?branch=all");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/v1/nav-counts");
    expect(document.querySelectorAll("[data-nav-count]")).toHaveLength(1);
  });

  it("shows Maintenance's new problems as a link into the Problems tab", async () => {
    serverSays({ moneyWaiting: null, maintenanceNew: 1 });
    await renderSidebar(membership("TECHNICIAN"));

    const count = await nav().findByRole("link", { name: "1 new problem to handle" });
    expect(count.getAttribute("href")).toBe("/maintenance?tab=issues&issueStatus=OPEN");
    expect(document.querySelectorAll("[data-nav-count]")).toHaveLength(1);
  });

  it("puts both counts on Direction's sidebar with one request", async () => {
    serverSays({ moneyWaiting: 2, maintenanceNew: 4 });
    await renderSidebar(membership("DIRECTOR"));

    await nav().findByRole("link", { name: "2 entries waiting for your approval" });
    await nav().findByRole("link", { name: "4 new problems to handle" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows nothing at zero", async () => {
    serverSays({ moneyWaiting: 0, maintenanceNew: 0 });
    await renderSidebar(membership("DIRECTOR"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(document.querySelector("[data-nav-count]")).toBeNull();
  });

  it.each<Role>(["DRIVER", "CASHIER"])("asks nothing for %s, who waits on no one here", async (role) => {
    serverSays({ moneyWaiting: 5, maintenanceNew: 5 });
    await renderSidebar(membership(role));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-nav-count]")).toBeNull();
  });

  it("asks nothing when the module behind the count is off", async () => {
    serverSays({ moneyWaiting: 5, maintenanceNew: 5 });
    await renderSidebar(membership("TECHNICIAN", ["CORE", "ASSETS", "FINANCE"]));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns the count into a dot in the collapsed rail, with the count in its tooltip and name", async () => {
    serverSays({ moneyWaiting: 3, maintenanceNew: null });
    await renderSidebar(membership("FINANCE"), false);

    const dot = await waitFor(() => {
      const found = document.querySelector("[data-nav-count-dot='moneyWaiting']");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(dot.textContent).toBe("3 entries waiting for your approval");
    expect(dot.closest("a")?.getAttribute("href")).toBe("/finance/entries");
  });

  it("counts in French with ICU plurals", async () => {
    await i18n.changeLanguage("fr");
    serverSays({ moneyWaiting: 1, maintenanceNew: 2 });
    await renderSidebar(membership("DIRECTOR"));

    await nav().findByRole("link", { name: "1 écriture attend votre approbation" });
    await nav().findByRole("link", { name: "2 nouveaux problèmes à traiter" });
  });
});
