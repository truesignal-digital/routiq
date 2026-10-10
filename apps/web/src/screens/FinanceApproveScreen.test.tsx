// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@routiq/contracts";
import { MeCtx, type MeContext } from "../auth/me.js";

const navigate = vi.fn();
const routeSearch = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => routeSearch.current,
}));

vi.mock("../finance/WaitingApprovals.js", () => ({
  WaitingApprovals: ({ arrivingWidened }: { arrivingWidened?: boolean }) => (
    <div data-testid="queue" data-widened={String(arrivingWidened)} />
  ),
}));

const { FinanceApproveScreen } = await import("./FinanceApproveScreen.js");

function renderAs(role: Role) {
  const me: MeContext = {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    principalId: "00000000-0000-4000-8000-000000000002",
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-000000000003",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role,
    branchScope: "ALL",
    enabledModules: ["CORE", "FINANCE"],
    enabledPresets: ["TRUCKING"],
  };
  return render(
    <MeCtx.Provider value={me}>
      <FinanceApproveScreen />
    </MeCtx.Provider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  routeSearch.current = {};
});

afterEach(cleanup);

describe("Money › To approve (#664)", () => {
  it("is the approver's queue, preset to the shell's branch", () => {
    renderAs("FINANCE");
    expect(screen.getByTestId("queue").dataset["widened"]).toBe("false");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens widened when a link already named the other branches", () => {
    routeSearch.current = { branch: "all" };
    renderAs("DIRECTOR");
    expect(screen.getByTestId("queue").dataset["widened"]).toBe("true");
  });

  it("sends anyone who decides nothing to Entries", () => {
    renderAs("CASHIER");
    expect(screen.queryByTestId("queue")).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: "/finance/entries", replace: true });
  });
});
