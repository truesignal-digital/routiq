// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoResponse } from "@routiq/contracts";
import { i18n } from "../i18n/index.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const state = vi.hoisted(() => ({ todo: undefined as TodoResponse | undefined }));
vi.mock("./useFleetAttention.js", () => ({
  useTodo: () => ({ data: state.todo, isError: false, refetch: vi.fn() }),
}));

const { DashboardTodoTab } = await import("./DashboardTodoTab.js");

function todo(shown: number, total = shown): TodoResponse {
  return {
    businessDate: "2026-10-09",
    scope: { ambientBranch: "IGNORED", branchIds: "ALL" },
    totalCount: total,
    rows: Array.from({ length: shown }, (_, index) => ({
      code: "VEHICLE_GROUNDED" as const,
      severity: "CRITICAL" as const,
      link: { kind: "asset" as const, id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`, number: null },
      asset: { id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`, assetCode: `VH0${index}` },
      branchId: null,
      since: "2026-10-01T08:00:00.000Z",
      params: { days: 2, workOrderPlanned: true },
    })),
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(cleanup);

describe("Dashboard › To do", () => {
  it("lists every row, not only the Overview's five, each with its button", () => {
    state.todo = todo(7);
    render(<DashboardTodoTab />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getAllByRole("link", { name: "Open" })[0]?.getAttribute("href")).toBe(
      "/assets/00000000-0000-4000-8000-000000000000",
    );
    expect(screen.getAllByText("Grounded 2 days · a work order is planned")).toHaveLength(7);
  });

  it("says when the server held rows back past its limit", () => {
    state.todo = todo(3, 64);
    render(<DashboardTodoTab />);
    expect(screen.getByText("Showing the first 3 of 64.")).toBeTruthy();
  });

  it("says when nothing waits", () => {
    state.todo = todo(0);
    render(<DashboardTodoTab />);
    expect(screen.getByText("Nothing waits for you.")).toBeTruthy();
  });
});
