// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ModuleCode } from "@routiq/contracts";
import type { MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";

const me: { current: MeContext | undefined } = { current: undefined };

vi.mock("../auth/me.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/me.js")>("../auth/me.js");
  return { ...actual, useMe: () => ({ data: me.current }) };
});

const session = {
  username: "ada",
  workspaceSlug: "transports-douala",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const logout = vi.fn();

vi.mock("../auth/store.js", () => ({
  sessionStore: { logout, getActive: () => session },
  useActiveSession: () => session,
}));

const { AppShell } = await import("./AppShell.js");

function membership(enabledModules: ModuleCode[]): MeContext {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    principalType: "HUMAN",
    membershipId: "33333333-3333-4333-8333-333333333333",
    role: "OPS_MANAGER",
    branchScope: "ALL",
    enabledModules,
  };
}

/** jsdom evaluates no media queries, so `useIsMobile` is driven explicitly. */
function setViewport(width: number) {
  window.innerWidth = width;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: width < 768,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const SCREEN_PATHS = [
  "/",
  "/assets",
  "/assets/new",
  "/finance/entries",
  "/finance/periods",
  "/more",
] as const;

async function renderShell(initialPath: string) {
  const rootRoute = createRootRoute();
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app",
    component: AppShell,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => <div>login screen</div>,
  });
  const screenRoutes = SCREEN_PATHS.map((path) =>
    createRoute({
      getParentRoute: () => shellRoute,
      path,
      component: () => <div data-testid="screen">{path}</div>,
    }),
  );
  const routeTree = rootRoute.addChildren([
    loginRoute,
    shellRoute.addChildren(screenRoutes),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  await screen.findByTestId("screen");
  return router;
}

/** Nav links live in the sidebar; the brand link and logout are not sections. */
function navLinkNames(): string[] {
  return within(screen.getByRole("navigation", { name: "Navigation" }))
    .getAllByRole("link")
    .map((link) => link.textContent?.trim() ?? "");
}

function activeNavName(): string | undefined {
  return within(screen.getByRole("navigation", { name: "Navigation" }))
    .getAllByRole("link")
    .find((link) => link.hasAttribute("data-active"))
    ?.textContent?.trim();
}

beforeEach(async () => {
  logout.mockClear();
  me.current = membership(["CORE", "ASSETS", "FINANCE"]);
  setViewport(1280);
  await i18n.changeLanguage("en");
});

afterEach(cleanup);

describe("AppShell (sidebar frame)", () => {
  it("renders every screen inside the sidebar inset, under the site header", async () => {
    await renderShell("/assets");

    const inset = document.querySelector("[data-slot='sidebar-inset']");
    expect(inset).not.toBeNull();
    expect(inset?.contains(screen.getByTestId("screen"))).toBe(true);
    expect(inset?.querySelector("header")).not.toBeNull();
  });

  it("has no bottom navigation left", async () => {
    await renderShell("/assets");

    const navs = screen.getAllByRole("navigation");
    // The sidebar and the SiteHeader breadcrumb; nothing pinned to the bottom.
    expect(navs.map((nav) => nav.getAttribute("aria-label")).sort()).toEqual([
      "Breadcrumb",
      "Navigation",
    ]);
    expect(document.querySelector("nav.fixed")).toBeNull();
  });

  it("shows one nav item per enabled module", async () => {
    await renderShell("/assets");
    expect(navLinkNames()).toEqual(["Home", "Assets", "Finance", "More"]);
  });

  it("drops the section of a disabled module entirely", async () => {
    me.current = membership(["CORE", "ASSETS"]);
    await renderShell("/assets");
    expect(navLinkNames()).toEqual(["Home", "Assets", "More"]);
  });

  it("renders only module-less sections while membership is still loading", async () => {
    me.current = undefined;
    await renderShell("/assets");
    expect(navLinkNames()).toEqual(["Home", "More"]);
  });

  it("marks the section owning the route active, and only that one", async () => {
    await renderShell("/finance/periods");
    expect(activeNavName()).toBe("Finance");
  });

  it("highlights Home on the landing route without swallowing the others", async () => {
    await renderShell("/");
    expect(activeNavName()).toBe("Home");

    cleanup();
    await renderShell("/assets/new");
    expect(activeNavName()).toBe("Assets");
  });

  it("keeps the parent section active on a child route", async () => {
    await renderShell("/assets/new");
    expect(activeNavName()).toBe("Assets");
  });

  it("names the current section in the site header", async () => {
    await renderShell("/finance/entries");
    const header = document.querySelector("[data-slot='sidebar-inset'] header");
    expect(header?.textContent).toContain("Finance");
  });

  it("overrides the English labels the vendored trigger and rail ship with", async () => {
    await renderShell("/assets");

    // aria-label wins over each one's own hardcoded "Toggle Sidebar".
    for (const slot of ["sidebar-trigger", "sidebar-rail"]) {
      const control = document.querySelector(`[data-slot='${slot}']`);
      expect(control?.getAttribute("aria-label")).toBe("Show or hide the menu");
    }
    const rail = document.querySelector("[data-slot='sidebar-rail']");
    expect(rail?.getAttribute("title")).toBe("Show or hide the menu");
  });

  it("logs out from the sidebar footer", async () => {
    await renderShell("/assets");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledWith(session);
  });

  describe("mobile", () => {
    beforeEach(() => setViewport(390));

    it("keeps the nav behind the trigger until it is opened", async () => {
      await renderShell("/assets");

      expect(screen.queryByRole("navigation", { name: "Navigation" })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Show or hide the menu" }));

      expect(navLinkNames()).toEqual(["Home", "Assets", "Finance", "More"]);
    });

    it("closes the sheet after navigating", async () => {
      const router = await renderShell("/assets");

      await userEvent.click(screen.getByRole("button", { name: "Show or hide the menu" }));
      await userEvent.click(screen.getByRole("link", { name: "Finance" }));

      expect(router.state.location.pathname).toBe("/finance/entries");
      expect(screen.queryByRole("navigation", { name: "Navigation" })).toBeNull();
    });

    it("labels the sheet in the active language", async () => {
      await renderShell("/assets");
      await userEvent.click(screen.getByRole("button", { name: "Show or hide the menu" }));
      expect(screen.getByRole("dialog", { name: "Navigation menu" })).toBeTruthy();

      cleanup();
      await i18n.changeLanguage("fr-CM");
      await renderShell("/assets");
      await userEvent.click(
        screen.getByRole("button", { name: "Afficher ou masquer le menu" }),
      );
      expect(screen.getByRole("dialog", { name: "Menu de navigation" })).toBeTruthy();
    });

    it("gives nav items and the trigger a 44px touch target", async () => {
      await renderShell("/assets");

      const trigger = screen.getByRole("button", { name: "Show or hide the menu" });
      expect(trigger.className).toContain("size-11");

      await userEvent.click(trigger);
      for (const link of within(
        screen.getByRole("navigation", { name: "Navigation" }),
      ).getAllByRole("link")) {
        expect(link.className).toContain("min-h-11");
      }
    });
  });
});
