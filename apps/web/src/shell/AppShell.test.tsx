// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  sessionStore: { logout, getActive: () => session, getToken: () => "token" },
  useActiveSession: () => session,
}));

/** The shell's branch switcher reads its options from here; no Query client. */
const branches: { current: Array<{ id: string; code: string; name: string }> } = {
  current: [],
};

vi.mock("../reference/asset-registration.js", () => ({
  useAssetRegistrationReference: () => ({
    data: { assetClasses: [], branches: branches.current },
    isError: false,
    refetch: vi.fn(),
  }),
}));

/** The notice's own behaviour has its own test; here only where it sits. */
vi.mock("../approval-rules/ApprovalRulesNotice.js", () => ({
  ApprovalRulesNotice: () => <div data-testid="rules-notice" />,
}));

const { AppShell } = await import("./AppShell.js");
const { PageContainer } = await import("../components/page-container.js");

function membership(enabledModules: ModuleCode[]): MeContext {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    principalType: "HUMAN",
    membershipId: "33333333-3333-4333-8333-333333333333",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role: "ADMIN",
    branchScope: "ALL",
    enabledModules,
    enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
    timezone: "Africa/Douala",
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
  "/maintenance",
] as const;

let client = new QueryClient();

async function renderShell(initialPath: string, ready = () => screen.findByTestId("screen")) {
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
  const pageRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: "/narrow-page",
    component: () => (
      <PageContainer width="narrow">
        <h1 data-testid="screen">Narrow page</h1>
        {/* A tab's permission screen is a container inside the page. */}
        <PageContainer>inner</PageContainer>
      </PageContainer>
    ),
  });
  const routeTree = rootRoute.addChildren([
    loginRoute,
    shellRoute.addChildren([...screenRoutes, pageRoute]),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  await ready();
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
  localStorage.clear();
  me.current = membership(["CORE", "ASSETS", "FINANCE"]);
  branches.current = [{ id: "branch-dla", code: "DLA", name: "Douala" }];
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

  it("lets the inset shrink below its content, so a wide table scrolls in its card instead of widening the page (#450)", async () => {
    await renderShell("/assets");

    // The inset is a flex item beside the sidebar; at the default
    // `min-width: auto` it grows to the widest table's min-content width.
    const inset = document.querySelector("[data-slot='sidebar-inset']");
    expect(inset?.classList.contains("min-w-0")).toBe(true);
  });

  it("pins the bottom bar for phones only (#318)", async () => {
    await renderShell("/assets");

    const navs = screen.getAllByRole("navigation");
    expect(navs.map((nav) => nav.getAttribute("aria-label")).sort()).toEqual([
      "Breadcrumb",
      "Navigation",
      "Shortcuts",
    ]);
    const bar = screen.getByRole("navigation", { name: "Shortcuts" });
    expect(bar.classList.contains("md:hidden")).toBe(true);
  });

  it("shows one nav item per enabled module", async () => {
    await renderShell("/assets");
    expect(navLinkNames()).toEqual(["Home", "Assets", "Money", "Users"]);
  });

  it("groups the rows under Daily work and Company", async () => {
    await renderShell("/assets");
    const nav = screen.getByRole("navigation", { name: "Navigation" });
    const headings = [...nav.querySelectorAll("[data-sidebar='group-label']")].map((h) => h.textContent);
    expect(headings).toEqual(["Daily work", "Company"]);
  });

  it("drops the section of a disabled module entirely", async () => {
    me.current = membership(["CORE", "ASSETS"]);
    await renderShell("/assets");
    expect(navLinkNames()).toEqual(["Home", "Assets", "Users"]);
  });

  it("renders only module-less sections while membership is still loading", async () => {
    me.current = undefined;
    // A core page: a module's page waits for membership (ModulePageGate).
    await renderShell("/");
    expect(navLinkNames()).toEqual(["Home"]);
  });

  it("marks the section owning the route active, and only that one", async () => {
    await renderShell("/finance/periods");
    expect(activeNavName()).toBe("Money");
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
    expect(header?.textContent).toContain("Money");
  });

  it("names a switched-off module's page in the site header, not just Home (#617)", async () => {
    await renderShell("/maintenance", () => screen.findByText("This module is not enabled for your company."));
    const header = document.querySelector("[data-slot='sidebar-inset'] header");
    expect(header?.querySelector("[data-slot='breadcrumb-page']")?.textContent).toBe("Maintenance");
    expect(screen.queryByTestId("screen")).toBeNull();
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

  it("puts the branch switcher in the site header when the scope spans branches", async () => {
    branches.current = [
      { id: "branch-dla", code: "DLA", name: "Douala" },
      { id: "branch-yde", code: "YDE", name: "Yaoundé" },
    ];
    await renderShell("/assets");

    const header = document.querySelector("[data-slot='sidebar-inset'] header");
    const switcher = screen.getByRole("combobox", { name: "Current branch" });
    expect(header?.contains(switcher)).toBe(true);
    expect(switcher.textContent).toContain("All my branches");
  });

  it("names the sole branch of a single-branch member without offering a choice", async () => {
    await renderShell("/assets");

    expect(screen.queryByRole("combobox", { name: "Current branch" })).toBeNull();
    // Still on screen: the scope is in force either way, and the shell is where
    // that is said.
    expect(screen.getByLabelText("Current branch").textContent).toBe("Douala");
  });

  it("marks the shell while a single branch is in force, and drops it on all", async () => {
    branches.current = [
      { id: "branch-dla", code: "DLA", name: "Douala" },
      { id: "branch-yde", code: "YDE", name: "Yaoundé" },
    ];
    await renderShell("/assets");
    const header = document.querySelector("[data-slot='sidebar-inset'] header");

    expect(header?.getAttribute("data-branch-scoped")).toBeNull();

    await userEvent.click(screen.getByRole("combobox", { name: "Current branch" }));
    await userEvent.click(await screen.findByRole("option", { name: "Douala" }));

    // One accent for "scoped", whichever branch it is — never a per-branch colour.
    expect(header?.getAttribute("data-branch-scoped")).toBe("true");
  });

  it("announces a branch switch to screen readers", async () => {
    branches.current = [
      { id: "branch-dla", code: "DLA", name: "Douala" },
      { id: "branch-yde", code: "YDE", name: "Yaoundé" },
    ];
    await renderShell("/assets");

    await userEvent.click(screen.getByRole("combobox", { name: "Current branch" }));
    await userEvent.click(await screen.findByRole("option", { name: "Yaoundé" }));

    const live = document.querySelector("[aria-live='polite']");
    expect(live?.textContent).toBe("You are viewing: Yaoundé");
  });

  it("asks for the approval rules again on every new screen (#422)", async () => {
    const router = await renderShell("/assets");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await router.navigate({ to: "/finance/entries" });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["ws", session.workspaceSlug, "approval-chain"],
      }),
    );
  });

  it("puts the approval-rules notice in the page's own column, once (#467)", async () => {
    await renderShell("/narrow-page");

    const notices = screen.getAllByTestId("rules-notice");
    expect(notices).toHaveLength(1);
    const column = screen.getByTestId("screen").closest("section");
    expect(column?.className).toContain("max-w-xl");
    expect(notices[0]?.parentElement).toBe(column);
  });

  it("logs out from the sidebar footer, forgetting every read made under the session", async () => {
    await renderShell("/assets");
    client.setQueryData(["ws", session.workspaceSlug, "me"], me.current);
    await userEvent.click(screen.getByRole("button", { name: /^Sali Ahmadou/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledWith(session);
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(await screen.findByText("login screen")).toBeTruthy();
  });

  describe("preset vocabulary", () => {
    it("renames the chrome of a single-preset workspace", async () => {
      me.current = { ...membership(["CORE", "ASSETS", "FINANCE"]), enabledPresets: ["TRUCKING"] };
      await renderShell("/assets");
      expect(navLinkNames()).toEqual(["Home", "Trucks", "Money", "Users"]);
    });

    // Runs after the overlay above: also proves unmounting clears it.
    it("keeps the base vocabulary for a mixed fleet", async () => {
      await renderShell("/assets");
      expect(navLinkNames()).toEqual(["Home", "Assets", "Money", "Users"]);
    });
  });

  describe("mobile", () => {
    beforeEach(() => setViewport(390));

    it("opens the sidebar sheet from the bottom bar's Menu, which steps aside meanwhile (#318)", async () => {
      await renderShell("/assets");

      const bar = screen.getByRole("navigation", { name: "Shortcuts" });
      await userEvent.click(within(bar).getByRole("button", { name: "Menu" }));

      expect(await screen.findByRole("dialog", { name: "Navigation menu" })).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole("navigation", { name: "Shortcuts" })).toBeNull());
    });

    it("keeps the nav behind the trigger until it is opened", async () => {
      await renderShell("/assets");

      expect(screen.queryByRole("navigation", { name: "Navigation" })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Show or hide the menu" }));

      expect(navLinkNames()).toEqual(["Home", "Assets", "Money", "Users"]);
    });

    it("closes the sheet after navigating", async () => {
      const router = await renderShell("/assets");

      await userEvent.click(screen.getByRole("button", { name: "Show or hide the menu" }));
      await userEvent.click(screen.getByRole("link", { name: "Money" }));

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
