// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { AssetsStub } from "./AssetsStub.js";
import { applyNavigate, useTestSearch } from "../test-router.js";

// A real Link needs a router around it; the screen renders bare here.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => applyNavigate,
  useSearch: () => useTestSearch(),
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

function renderWith(
  role: MeContext["role"],
  enabledModules: MeContext["enabledModules"] = ["CORE", "ASSETS"],
) {
  const me: MeContext = {
    workspaceId: "ws",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role,
    branchScope: "ALL",
    enabledModules,
    enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
    timezone: "Africa/Douala",
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MeCtx.Provider value={me}>
        <AssetsStub />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("register affordances by role", () => {
  it("ADMIN sees the register affordance", () => {
    renderWith("ADMIN");
    expect(
      screen.getAllByRole("link", { name: /enregistrer un actif/i }).length,
    ).toBeGreaterThan(0);
  });

  it("CASHIER sees zero mutating affordances", () => {
    renderWith("CASHIER");
    expect(screen.queryByRole("link", { name: /enregistrer un actif/i })).toBeNull();
    expect(document.querySelector('a[href="/assets/new"]')).toBeNull();
  });
});

describe("module gating", () => {
  // With Assets off the shell never opens this screen: modules/manifests.test.tsx.
  it("serves the fleet to a role that may not register one", () => {
    renderWith("CASHIER");

    expect(screen.getByRole("searchbox")).toBeDefined();
  });
});
