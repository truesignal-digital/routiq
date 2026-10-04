// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ModuleCode, Role } from "@routiq/contracts";
import type { MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { LANGUAGE_STORAGE_KEY } from "../i18n/language.js";

const session = {
  username: "amina",
  workspaceSlug: "sotrafret",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

vi.mock("../auth/store.js", () => ({
  sessionStore: { logout: vi.fn(), getActive: () => session },
  useActiveSession: () => session,
}));

let meValue: MeContext | undefined;

vi.mock("../auth/me.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/me.js")>("../auth/me.js");
  return { ...actual, useMeContext: () => meValue };
});

const { MoreStub } = await import("./MoreStub.js");

function membership(role: Role, enabledModules: ModuleCode[]): MeContext {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    principalType: "HUMAN",
    membershipId: "33333333-3333-4333-8333-333333333333",
    role,
    branchScope: "ALL",
    enabledModules,
    enabledPresets: ["TRUCKING"],
  };
}

function renderMore(me: MeContext) {
  meValue = me;
  const rootRoute = createRootRoute();
  const moreRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/more",
    component: MoreStub,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moreRoute]),
    history: createMemoryHistory({ initialEntries: ["/more"] }),
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("MoreStub administration links", () => {
  it("offers an admin the Users screen", async () => {
    renderMore(membership("ADMIN", ["CORE", "ACTIVITIES"]));

    const link = await screen.findByRole("link", { name: /Utilisateurs/ });
    expect(link.getAttribute("href")).toBe("/more/users");
  });

  it("leaves no Users entry for a role that could not use it", async () => {
    renderMore(membership("OPS_MANAGER", ["CORE", "ACTIVITIES"]));

    await screen.findByRole("link", { name: /Personnel/ });
    expect(screen.queryByRole("link", { name: /Utilisateurs/ })).toBeNull();
  });

  it("offers an admin the Branches screen", async () => {
    renderMore(membership("ADMIN", ["CORE", "ACTIVITIES"]));

    const link = await screen.findByRole("link", { name: /Agences/ });
    expect(link.getAttribute("href")).toBe("/more/branches");
  });

  it("leaves no Branches entry for a role that could not use it", async () => {
    renderMore(membership("OPS_MANAGER", ["CORE", "ACTIVITIES"]));

    await screen.findByRole("link", { name: /Personnel/ });
    expect(screen.queryByRole("link", { name: /Agences/ })).toBeNull();
  });

  it("keeps the Users entry when the workspace bought no other module", async () => {
    // CORE cannot be disabled, so member administration never disappears with
    // a module the way Personnel does.
    renderMore(membership("ADMIN", ["CORE"]));

    expect(await screen.findByRole("link", { name: /Utilisateurs/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Personnel/ })).toBeNull();
  });
});

describe("MoreStub language", () => {
  afterEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("fr-CM");
  });

  it("remembers the language picked on More for the next load", async () => {
    renderMore(membership("OPS_MANAGER", ["CORE"]));

    await userEvent.click(await screen.findByRole("button", { name: "English" }));

    expect(await screen.findByRole("heading", { name: "Language" })).toBeTruthy();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");

    await userEvent.click(screen.getByRole("button", { name: "Français" }));

    expect(await screen.findByRole("heading", { name: "Langue" })).toBeTruthy();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr-CM");
  });
});
