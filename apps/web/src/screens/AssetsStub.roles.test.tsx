// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { AssetsStub } from "./AssetsStub.js";

function renderWithRole(role: MeContext["role"]) {
  const me: MeContext = {
    workspaceId: "ws",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    role,
    branchScope: "ALL",
    enabledModules: ["CORE", "ASSETS"],
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
    renderWithRole("ADMIN");
    expect(screen.getAllByRole("link", { name: /nouvel actif/i }).length).toBeGreaterThan(0);
  });

  it("EXECUTIVE_VIEWER sees zero mutating affordances", () => {
    renderWithRole("EXECUTIVE_VIEWER");
    expect(screen.queryByRole("link", { name: /nouvel actif/i })).toBeNull();
    expect(document.querySelector('a[href="/assets/new"]')).toBeNull();
  });
});
