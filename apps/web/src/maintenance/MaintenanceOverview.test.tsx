// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { testUsage } from "../overview/test-usage.js";
import type { IssueListItem, MaintenanceSummary } from "@routiq/contracts";
import { MaintenanceOverview, maintenanceToDo } from "./MaintenanceOverview.js";

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

const ME: MeContext = {
  workspaceId: "ws",
  principalId: "p",
  principalType: "HUMAN",
  membershipId: "m",
  role: "TECHNICIAN",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS", "MAINTENANCE"],
  enabledPresets: ["TRUCKING"],
  timezone: "Africa/Douala",
  displayName: "Paul Mbarga",
  workspaceName: "Transports Ngwa",
};

function renderWith(summary: unknown, usage: unknown = testUsage(), me?: MeContext) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      const body = href.startsWith("/v1/issues") ? ISSUES : href.startsWith("/v1/assets/usage") ? usage : summary;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MeCtx.Provider value={me}>
        <MaintenanceOverview />
      </MeCtx.Provider>
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
    await screen.findByText("VH003 · since 1 October 2026");
    expect(linkOf("New problems")).toBe("/maintenance/problems?status=OPEN");
    expect(linkOf("Off the road")).toBe("/assets/list?availability=GROUNDED");
    expect(linkOf("Work orders open")).toBe("/maintenance/work-orders?only=open");
    expect(linkOf("Repair cost")).toBe("/maintenance/work-orders?status=COMPLETED");
    // Only the decision something waits for: nothing waits for sign-off here.
    expect(screen.getByText("1 waiting approval")).toBeTruthy();
    expect(screen.queryByText(/waiting sign-off/)).toBeNull();
  });

  it("drops the repair cost tile for a role the server withholds it from", async () => {
    renderWith({ ...SUMMARY, repairCost: null });
    await screen.findByText("VH003 · since 1 October 2026");
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
    await screen.findByText("VH003 · since 1 October 2026");
    expect(screen.queryByText(/revenue|profit/i)).toBeNull();
  });

  it("draws days off the road per month, the current month partial and said so (#668)", async () => {
    const { container } = renderWith(SUMMARY);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-slot=month-column]")).toHaveLength(12));
    expect(screen.getByRole("img", { name: "October (so far): 12 vehicle-days off the road" })).toBeTruthy();
    expect(screen.getByText("October is partial (9 days).")).toBeTruthy();
    expect(linkOf("Open Work orders")).toBe("/maintenance/work-orders");
  });

  it("leaves the chart out while Maintenance is off", async () => {
    const { container } = renderWith(SUMMARY, { ...testUsage(), offRoadByMonth: null });
    await screen.findByText("VH003 · since 1 October 2026");
    await vi.waitFor(() => expect(container.querySelector("[data-slot=days-off-road]")).toBeNull());
  });

  it("keeps the grounding, the safety count and the window the figures cover at rest, on the tiles", async () => {
    const { container } = renderWith({
      ...SUMMARY,
      notice: {
        today: "2026-10-09",
        schedule: "MONDAY_AND_MONTH_START",
        scheduledOn: "2026-10-05",
        scheduledToday: null,
        changes: [
          { kind: "VEHICLE_GROUNDED", key: "G1", assetId: "a3", assetCode: "VH003", since: "2026-10-07T08:00:00.000Z" },
        ],
      },
    });
    await screen.findByText("VH003 · since 1 October 2026");
    // Grounded and severity: the tiles name them, in the warning tone, without opening anything.
    const tile = (name: string) => screen.getByRole("link", { name }).closest("[data-tone]");
    expect(tile("Off the road")?.getAttribute("data-tone")).toBe("warning");
    expect(tile("New problems")?.getAttribute("data-tone")).toBe("warning");
    expect(screen.getByText("1 safety critical")).toBeTruthy();
    // The window the repair figures cover (§9 period basis) stays on the tiles.
    // Average days to repair and repair cost each say the window they cover.
    expect(screen.getAllByText("4 repairs in the last 90 days")).toHaveLength(2);
    // What needs the workshop leads the page.
    const overview = container.querySelector("[data-slot=maintenance-overview]") as HTMLElement;
    expect(overview.firstElementChild?.getAttribute("data-slot")).toBe("maintenance-todo");
  });

  it("puts the summary notice under To do and over the tiles when a grounding is the big change; closed, it stays closed after a reload (#667)", async () => {
    localStorage.clear();
    const grounded = {
      ...SUMMARY,
      notice: {
        today: "2026-10-09",
        schedule: "MONDAY_AND_MONTH_START",
        scheduledOn: "2026-10-05",
        scheduledToday: null,
        changes: [
          { kind: "VEHICLE_GROUNDED", key: "G1", assetId: "a3", assetCode: "VH003", since: "2026-10-07T08:00:00.000Z" },
        ],
      },
    };
    const { container, unmount } = renderWith(grounded, testUsage(), ME);
    const region = await screen.findByRole("region", { name: "Summary" });
    expect(region.getAttribute("data-reason")).toBe("CHANGE");
    expect(region.textContent).toContain("2 problems are open, 1 of them safety-critical.");
    expect(region.textContent).toContain("1 vehicle is off the road.");
    expect(region.textContent).toContain("VH003 was grounded on 7 October and is still off the road.");
    expect(within(region).getByText("1 off the road")).toBeTruthy();
    // To do leads, then the notice, then the tiles.
    const overview = container.querySelector("[data-slot=maintenance-overview]") as HTMLElement;
    expect(overview.firstElementChild?.getAttribute("data-slot")).toBe("maintenance-todo");
    expect(region.compareDocumentPosition(container.querySelector("[data-slot=metric-strip]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(within(region).getByRole("button", { name: "Close the summary" }));
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show summary" }).closest("[data-summary=closed]")).toBeTruthy();

    unmount();
    renderWith(grounded, testUsage(), ME);
    await screen.findByRole("button", { name: "Show summary" });
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show summary" }));
    expect((await screen.findByRole("region", { name: "Summary" })).textContent).toContain("2 problems are open");
  });

  it("on a day it is not due shows the tiles and only the line with Show summary (#667)", async () => {
    localStorage.clear();
    renderWith(
      { ...SUMMARY, notice: { today: "2026-10-09", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] } },
      testUsage(),
      ME,
    );
    const show = await screen.findByRole("button", { name: "Show summary" });
    expect(show.closest("[data-summary=closed]")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    // What the repair figures count stays on their tiles, so the line repeats nothing.
    expect(screen.getAllByText("4 repairs in the last 90 days")).toHaveLength(2);
  });

  it("folds several problems of a kind into one counted row, and shows at most three rows", async () => {
    const many = {
      items: [
        issue("s1", "VH006", "Brakes squeal", true, "2026-10-09T08:00:00.000Z"),
        issue("s2", "VH007", "Steering pulls", true, "2026-10-08T08:00:00.000Z"),
        issue("o1", "VH001", "Left mirror broken", false, "2026-10-08T08:00:00.000Z"),
        issue("o2", "VH002", "Seat torn", false, "2026-10-07T08:00:00.000Z"),
      ],
      nextCursor: null,
    };
    const rows = maintenanceToDo({ ...SUMMARY, waitingCompletion: 1 } as MaintenanceSummary, many.items as IssueListItem[], i18n.t, "en");
    expect(rows.map((row) => row.title)).toEqual([
      "2 safety problems to triage",
      "1 work order waits for approval",
      "1 work order waits for sign-off",
      "2 problems to triage",
    ]);
    expect(rows[0]?.action).toEqual({ label: "Triage", to: "/maintenance/problems", search: { status: "OPEN" } });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url);
        const body = href.startsWith("/v1/issues") ? many : href.startsWith("/v1/assets/usage") ? testUsage() : { ...SUMMARY, waitingCompletion: 1 };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MaintenanceOverview />
      </QueryClientProvider>,
    );
    await screen.findByText("2 safety problems to triage");
    expect(container.querySelectorAll("[data-slot=to-do-row]")).toHaveLength(3);
    // The hidden fourth row is always the other problems, so See all opens them.
    expect(linkOf("See all")).toBe("/maintenance/problems?status=OPEN");
  });

  it("explains the chart's unit behind one tap, not a resting sentence", async () => {
    renderWith(SUMMARY);
    await screen.findByText("October is partial (9 days).");
    expect(screen.queryByText("Vehicle-days in the workshop or grounded, per month.")).toBeNull();
    expect(screen.getByRole("button", { name: "How this is calculated" })).toBeTruthy();
  });
});
