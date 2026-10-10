// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import { MaintenanceOverview } from "./MaintenanceOverview.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search, children, ...props }: { to: string; search?: Record<string, string>; children?: ReactNode }) => (
    <a href={search === undefined ? to : `${to}?${new URLSearchParams(search).toString()}`} {...props}>
      {children}
    </a>
  ),
}));

const SUMMARY = {
  openIssues: 2,
  openSafetyCritical: 1,
  grounded: 1,
  firstGrounded: { assetId: "a3", assetCode: "VH003", since: "2026-10-01T08:00:00.000Z" },
  approvedWorkOrders: 1,
  openWorkOrders: 2,
  waitingApproval: 1,
  waitingCompletion: 0,
  averageRepairDays: 3.5,
  repairsCounted: 4,
  repairWindowDays: 90,
  repairCost: { amountMinor: 640000, currency: "XAF", workOrders: 4 },
};

const issue = (id: string, code: string, description: string, safetyCritical: boolean, reportedAt: string, workOrders: unknown[] = []) => ({
  id,
  number: 1,
  asset: { id: `asset-${id}`, assetCode: code, registrationNumber: null },
  branch: { id: "b", code: "DLA", name: "Douala" },
  description,
  safetyCritical,
  category: null,
  reportedAt,
  status: "OPEN",
  resolvedAt: null,
  resolutionNote: null,
  dismissedAt: null,
  dismissReason: null,
  workOrders,
  assetUnavailable: false,
  rowVersion: 1,
});

const ISSUES = {
  items: [
    issue("i1", "VH001", "Left mirror broken", false, "2026-10-08T08:00:00.000Z"),
    issue("i2", "VH006", "Brakes squeal", true, "2026-10-09T08:00:00.000Z"),
    // Planned already: a live work order covers it, so nobody needs to triage it.
    issue("i3", "VH003", "Brake pads", true, "2026-10-01T08:00:00.000Z", [{ id: "w1", number: 12, status: "APPROVED" }]),
  ],
  nextCursor: null,
};

function renderWith(summary: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) =>
      new Response(JSON.stringify(String(url).startsWith("/v1/issues") ? ISSUES : summary), { status: 200 }),
    ),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MaintenanceOverview />
    </QueryClientProvider>,
  );
}

const linkOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("Maintenance › Overview (#665)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterAll(async () => {
    await i18n.changeLanguage("fr-CM");
  });
  beforeEach(() => {
    sessionStore.save({ username: "ada", workspaceSlug: "ws-1", token: "tok", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("opens each tile's tab already filtered", async () => {
    renderWith(SUMMARY);
    await screen.findByText("VH003 · since 10/1/26");
    expect(linkOf("New problems")).toBe("/maintenance/problems?status=OPEN");
    expect(linkOf("Off the road")).toBe("/assets/list?availability=GROUNDED");
    expect(linkOf("Work orders open")).toBe("/maintenance/work-orders?only=open");
    expect(linkOf("Repair cost")).toBe("/maintenance/work-orders?status=COMPLETED");
    expect(screen.getByText("1 waiting approval · 0 waiting sign-off")).toBeTruthy();
  });

  it("drops the repair cost tile for a role the server withholds it from", async () => {
    renderWith({ ...SUMMARY, repairCost: null });
    await screen.findByText("VH003 · since 10/1/26");
    expect(screen.queryByRole("link", { name: "Repair cost" })).toBeNull();
  });

  it("puts safety first: safety problems, then work orders waiting, then the rest", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("VH006 · Brakes squeal");
    const rows = [...container.querySelectorAll("[data-slot=to-do-row]")].map((row) => row.querySelector("p")?.textContent);
    expect(rows).toEqual(["VH006 · Brakes squeal", "1 work order waits for approval", "VH001 · Left mirror broken"]);
    const todo = within(container.querySelector("[data-slot=to-do-list]") as HTMLElement);
    expect(todo.getAllByRole("link", { name: "Triage" })[0]?.getAttribute("href")).toBe(
      "/assets/asset-i2/maintenance?panel=issue%3Ai2",
    );
  });

  it("shows no revenue and no profit: repair cost comes from work orders only", async () => {
    renderWith(SUMMARY);
    await screen.findByText("VH003 · since 10/1/26");
    expect(screen.queryByText(/revenue|profit/i)).toBeNull();
  });
});
