// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
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
