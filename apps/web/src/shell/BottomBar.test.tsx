// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { BottomBar } from "./BottomBar.js";
import { bottomBarPlaces } from "./bottom-bar.js";

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
    timezone: "Africa/Douala",
    displayName: "Emilienne Ngo",
    workspaceName: "Transports Ngwa",
  };
}

async function renderBar(me: MeContext, path = "/") {
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
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId("page");
  return screen.getByRole("navigation", { name: "Shortcuts" });
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("bottom bar places (#318)", () => {
  // The table in #318. The driver's middle place is Trucks until #266 links a login to its person.
  const expected: Record<Role, string[]> = {
    DIRECTOR: ["home", "assets", "finances"],
    ADMIN: ["home", "assets", "finances"],
    FINANCE: ["home", "finances", "assets"],
    CASHIER: ["home", "finances", "assets"],
    TECHNICIAN: ["home", "maintenance", "assets"],
    DRIVER: ["home", "assets", "activities"],
  };

  it.each(ROLES)("%s gets its three places", (role) => {
    expect(bottomBarPlaces(role, EVERY).map((place) => place.key)).toEqual(expected[role]);
  });

  it("drops a place whose module is off", () => {
    const withoutFinance = EVERY.filter((code) => code !== "FINANCE");
    expect(bottomBarPlaces("DIRECTOR", withoutFinance).map((place) => place.key)).toEqual(["home", "assets"]);
    const withoutMaintenance = EVERY.filter((code) => code !== "MAINTENANCE");
    expect(bottomBarPlaces("TECHNICIAN", withoutMaintenance).map((place) => place.key)).toEqual(["home", "assets"]);
  });

  it("shows Home alone while the role is loading", () => {
    expect(bottomBarPlaces(undefined, undefined).map((place) => place.key)).toEqual(["home"]);
  });
});

describe("BottomBar", () => {
  it("shows the role's places, then Menu, on phones only", async () => {
    const bar = await renderBar(membership("TECHNICIAN"));
    expect(within(bar).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home",
      "Maintenance",
      "Assets",
    ]);
    expect(within(bar).getByRole("button", { name: "Menu" })).toBeTruthy();
    expect(bar.classList.contains("md:hidden")).toBe(true);
  });

  it("marks the place the route belongs to", async () => {
    const bar = await renderBar(membership("FINANCE"), "/finance/entries");
    const current = within(bar)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["Money"]);
  });

  it("is gone while a form panel is open, and back when it closes", async () => {
    await renderBar(membership("DIRECTOR"));
    const panel = document.createElement("div");
    panel.setAttribute("data-slot", "sheet-content");
    await act(async () => {
      document.body.append(panel);
    });
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).toBeNull();
    await act(async () => {
      panel.remove();
    });
    expect(screen.getByRole("navigation", { name: "Shortcuts" })).toBeTruthy();
  });
});
