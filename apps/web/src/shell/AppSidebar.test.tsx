// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import type { BranchScope, Role } from "@routiq/contracts";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";

const { session, logout, DOUALA, YAOUNDE } = vi.hoisted(() => ({
  session: {
    username: "sali",
    workspaceSlug: "transports-ngwa",
    token: "token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  logout: vi.fn(),
  DOUALA: "44444444-4444-4444-8444-444444444444",
  YAOUNDE: "55555555-5555-4555-8555-555555555555",
}));

vi.mock("../auth/store.js", () => ({
  sessionStore: { logout, getActive: () => session, getToken: () => "token" },
  useActiveSession: () => session,
}));

vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: () => ({
    data: {
      assetClasses: [],
      branches: [
        { id: DOUALA, code: "DLA", name: "Douala" },
        { id: YAOUNDE, code: "YDE", name: "Yaoundé" },
      ],
    },
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { AppSidebar } = await import("./AppSidebar.js");
const { BranchProvider } = await import("./branch-context.js");

function member(role: Role, branchScope: BranchScope = [DOUALA]): MeContext {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    principalType: "HUMAN",
    membershipId: "33333333-3333-4333-8333-333333333333",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role,
    branchScope,
    enabledModules: ["CORE", "ASSETS", "ACTIVITIES", "FINANCE", "MAINTENANCE"],
    enabledPresets: ["TRUCKING"],
  };
}

function renderSidebar(me: MeContext, { collapsed = false } = {}) {
  const rootRoute = createRootRoute({
    component: () => (
      <MeCtx.Provider value={me}>
        <BranchProvider>
          <SidebarProvider defaultOpen={!collapsed}>
            <AppSidebar />
            <main>
              <Outlet />
            </main>
          </SidebarProvider>
        </BranchProvider>
      </MeCtx.Provider>
    ),
  });
  const pages = ["/", "/my-settings", "/more/persons", "/more/users", "/more/branches", "/login"].map(
    (path) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: () => <p>page {path}</p>,
      }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(pages),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return router;
}

async function openNameMenu() {
  await userEvent.click(await screen.findByRole("button", { name: /^Sali Ahmadou/ }));
  return screen.findByRole("menu");
}

beforeEach(async () => {
  logout.mockClear();
  await i18n.changeLanguage("en");
});

afterEach(cleanup);

describe("the name menu in the sidebar footer (#316)", () => {
  it("shows the initial, the name, and the translated role with the branch", async () => {
    await i18n.changeLanguage("fr-CM");
    renderSidebar(member("DRIVER"));

    const trigger = await screen.findByRole("button", { name: /Sali Ahmadou/ });
    expect(trigger.querySelector("span[aria-hidden]")?.textContent).toBe("S");
    expect(within(trigger).getByText("Chauffeur · Douala")).toBeTruthy();
  });

  it("names a whole-workspace scope and a several-branch scope", async () => {
    renderSidebar(member("DIRECTOR", "ALL"));
    expect(await screen.findByText("Director · All my branches")).toBeTruthy();
    cleanup();

    renderSidebar(member("FINANCE", [DOUALA, YAOUNDE]));
    expect(await screen.findByText("Finance · 2 branches")).toBeTruthy();
  });

  it("opens a menu with My settings and Sign out, each a 44px target", async () => {
    renderSidebar({ ...member("DRIVER"), enabledModules: ["CORE", "ASSETS", "FINANCE"] });
    const menu = await openNameMenu();

    expect(within(menu).getByText("Transports Ngwa")).toBeTruthy();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["My settings", "Sign out"]);
    for (const item of items) expect(item.className).toContain("min-h-11");
  });

  it("goes to My settings", async () => {
    const router = renderSidebar(member("DRIVER"));
    await openNameMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "My settings" }));
    expect(router.state.location.pathname).toBe("/my-settings");
  });

  it("signs out from the menu", async () => {
    const router = renderSidebar(member("DRIVER"));
    await openNameMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledWith(session);
    expect(await screen.findByText("page /login")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("opens the same menu from the initial on the collapsed rail", async () => {
    renderSidebar(member("DRIVER"), { collapsed: true });
    const menu = await openNameMenu();
    expect(within(menu).getByRole("menuitem", { name: "My settings" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("leaves the administration pages to the sidebar's Company rows (#312)", async () => {
    renderSidebar(member("DIRECTOR", "ALL"));
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    for (const name of ["People", "Users", "Branches"]) {
      expect(within(nav).getByRole("link", { name })).toBeTruthy();
    }
    const menu = await openNameMenu();
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "My settings",
      "Sign out",
    ]);
  });

  it("has no More row", async () => {
    renderSidebar(member("DIRECTOR", "ALL"));
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    expect(within(nav).queryByRole("link", { name: "More" })).toBeNull();
  });
});

describe("sign out lives in one place", () => {
  const SRC = resolve(__dirname, "..");

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("is imported by the name menu only", () => {
    const users = sources(SRC)
      .filter((path) => /\buseSignOut\b/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path))
      .sort();
    expect(users).toEqual(["auth/sign-out.ts", "shell/NameMenu.tsx"]);
  });
});
