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
import { TripsOverview } from "./TripsOverview.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search, children, ...props }: { to: string; search?: Record<string, string>; children?: ReactNode }) => (
    <a href={search === undefined ? to : `${to}?${new URLSearchParams(search).toString()}`} {...props}>
      {children}
    </a>
  ),
}));

const WEEKS = Array.from({ length: 12 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 6, 20 + index * 7));
  const end = new Date(day.getTime() + 6 * 86_400_000);
  return { from: day.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), started: index + 1, closed: index };
});

const SUMMARY = {
  week: { from: "2026-10-05", to: "2026-10-11" },
  thisWeek: 6,
  weekClosed: 4,
  open: 5,
  oldestOpen: { id: "t1", activityNumber: "DLA-2026-00031", startedAt: "2026-10-06T06:00:00.000Z", assetCode: "VH006" },
  incomplete: 5,
  closedMissing: { fuel: 3, km: 2 },
  weekKm: 1840,
  weeks: WEEKS,
};

const ME: MeContext = {
  workspaceId: "ws",
  principalId: "p",
  principalType: "HUMAN",
  membershipId: "m",
  role: "ADMIN",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS", "ACTIVITIES", "FINANCE"],
  enabledPresets: ["TRUCKING"],
  timezone: "Africa/Douala",
  displayName: "Emilienne Ngo",
  workspaceName: "Transports Ngwa",
};

const MONDAY = { today: "2026-10-05", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: "MONDAY", changes: [] };

function renderWith(summary: unknown, usage: unknown = testUsage(), me?: MeContext) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) =>
      new Response(JSON.stringify(String(url).startsWith("/v1/assets/usage") ? usage : summary), { status: 200 }),
    ),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MeCtx.Provider value={me}>
        <TripsOverview />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

const linkOf = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");

describe("Trips › Overview (#665)", () => {
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

  it("opens each tile's list already filtered to what it counted", async () => {
    renderWith(SUMMARY);
    await screen.findByText("3 without fuel · 2 without km");
    expect(linkOf("Closed this week")).toBe("/activities/list?status=CLOSED&from=2026-10-05&to=2026-10-11");
    // Started this week reads in the weekly chart; its tile made room for km driven empty (#668).
    expect(screen.queryByRole("link", { name: "This week" })).toBeNull();
    expect(linkOf("On the road")).toBe("/activities/list?status=OPEN");
    expect(linkOf("Closed with missing data")).toBe("/activities/list?completeness=COMPLETE_WITH_EXCEPTIONS");
    expect(screen.getByText("1,840 km")).toBeTruthy();
  });

  it("says at rest that Closed this week counts only trips started since Monday", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("3 without fuel · 2 without km");
    const tile = container.querySelector<HTMLElement>("[data-metric=week-closed]")!;
    expect(within(tile).getByText("Of those started since Monday")).toBeTruthy();
  });

  it("says at rest under the chart that this week is still running", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("3 without fuel · 2 without km");
    const card = container.querySelector<HTMLElement>("[data-slot=trips-per-week]")!;
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card).getByText("This week is still running.")).toBeTruthy();
  });

  it("draws twelve weeks, each column a link to its week", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("3 without fuel · 2 without km");
    const columns = container.querySelectorAll("[data-slot=week-column] a");
    expect(columns).toHaveLength(12);
    expect(columns[11]?.getAttribute("href")).toBe(`/activities/list?from=${WEEKS[11]!.from}&to=${WEEKS[11]!.to}`);
    expect(columns[11]?.getAttribute("aria-label")).toContain("12 started, 11 closed");
  });

  it("leads with what is left to close, one kind a row, its verb the next step", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("5 still open");
    const card = container.querySelector("[data-slot=trips-todo-card]") as HTMLElement;
    // First on the page, before any figure.
    expect(container.querySelector("[data-slot=trips-overview]")?.firstElementChild).toBe(card);
    const todo = within(card.querySelector("[data-slot=to-do-list]") as HTMLElement);
    expect(todo.getAllByRole("listitem").map((row) => row.querySelector("p")?.textContent)).toEqual([
      "5 still open",
      "3 closed without fuel",
      "2 closed without km",
    ]);
    const buttons = todo.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);
    expect(buttons).toEqual([
      ["Close them", "/activities/list?status=OPEN"],
      ["Complete", "/activities/list?missing=fuel"],
      ["Complete", "/activities/list?missing=km"],
    ]);
    // The oldest open trip's date reads once, on the On the road tile.
    expect(container.querySelector("[data-metric=open]")?.textContent).toContain("6 October 2026");
  });

  it("leaves fuel out while Money is off: not counted is never none", async () => {
    renderWith({ ...SUMMARY, closedMissing: { fuel: null, km: 2 } });
    expect(await screen.findByText("2 without km")).toBeTruthy();
    expect(screen.queryByText(/without fuel/)).toBeNull();
  });

  it("says Not recorded for the week's km when no leg carries a distance", async () => {
    const { container } = renderWith({ ...SUMMARY, weekKm: null });
    await screen.findByText("5 still open");
    const tile = container.querySelector("[data-metric=week-km]");
    expect(tile?.textContent).toContain("Not recorded");
  });

  it("tiles the share of km driven empty against the comparison window, and says what it left out (#668)", async () => {
    const { container } = renderWith(SUMMARY);
    const value = () => container.querySelector("[data-metric=empty-km] [data-slot=metric-value]")?.textContent;
    await vi.waitFor(() => expect(value()).toBe("18%"));
    expect(container.querySelector("[data-metric=empty-km]")?.textContent?.replace(/\s/g, " ")).toContain(
      "▲ 3 pts vs 1–9 Sept · 150 km without a load not counted",
    );
  });

  it("says the share is not recorded when no leg records its load, never 0 %", async () => {
    const usage = testUsage();
    const trips = usage.trips === null ? null : { ...usage.trips, period: { emptyKm: 0, loadedKm: 0, unknownLoadKm: 0 } };
    const { container } = renderWith(SUMMARY, { ...usage, trips });
    await vi.waitFor(() =>
      expect(container.querySelector("[data-metric=empty-km] [data-slot=metric-value]")?.textContent).toBe("Not recorded"),
    );
  });

  it("ranks revenue per km by route and names the routes it could not count", async () => {
    const { container } = renderWith(SUMMARY);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-slot=ranked-bars-row]")).toHaveLength(2));
    const card = container.querySelector("[data-slot=revenue-per-km-by-route]") as HTMLElement;
    // The window the ranking covers is said at rest, not only behind the (i).
    expect(card.querySelector("[data-slot=routes-period]")?.textContent).toBe("1–9 October");
    const rows = [...card.querySelectorAll("[data-slot=ranked-bars-row]")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("Douala – Yaoundé");
    expect(rows[1]).toContain("Bafoussam – Douala");
    expect(rows[1]).toContain("1 activity without km");
    expect(card.textContent).toContain("Not counted, no km recorded: Douala – Kribi.");
    expect(card.textContent).toContain("2 other routes are not shown.");
    expect(card.textContent).toContain("1 closed activity has no leg, so no route.");
  });

  it("leaves revenue per km out for a role that reads no vehicle money", async () => {
    const usage = testUsage();
    const trips = usage.trips === null ? null : { ...usage.trips, routes: usage.trips.routes.map((route) => ({ ...route, revenueMinor: null, revenuePerKmMinor: null })) };
    const { container } = renderWith(SUMMARY, { ...usage, money: null, trips, vehicles: usage.vehicles.map((vehicle) => ({ ...vehicle, money: null })) });
    await vi.waitFor(() => expect(container.querySelector("[data-metric=empty-km] [data-slot=metric-value]")?.textContent).toBe("18%"));
    expect(container.querySelector("[data-slot=revenue-per-km-by-route]")).toBeNull();
  });

  it("keeps what the figures leave out at rest, on the missing-data tile, even with a notice due", async () => {
    localStorage.clear();
    const { container } = renderWith({ ...SUMMARY, notice: MONDAY }, testUsage(), ME);
    await screen.findByRole("region", { name: "Summary" });
    const tile = container.querySelector("[data-metric=incomplete]") as HTMLElement;
    expect(tile.textContent).toContain("5");
    expect(tile.textContent).toContain("3 without fuel · 2 without km");
    // The counts are on the tile, so the summary carries no counted line repeating them.
    expect(container.querySelector("[data-slot=overview-counted]")).toBeNull();
  });

  it("puts the summary notice under To do and over the tiles on a Monday; closed, it stays closed after a reload (#667)", async () => {
    localStorage.clear();
    const { container, unmount } = renderWith({ ...SUMMARY, notice: MONDAY }, testUsage(), ME);
    const region = await screen.findByRole("region", { name: "Summary" });
    expect(region.getAttribute("data-reason")).toBe("MONDAY");
    expect(region.textContent).toContain("6 activities started this week; 4 of them closed.");
    expect(region.textContent).toContain("5 activities are still open.");
    const overview = container.querySelector("[data-slot=trips-overview]") as HTMLElement;
    expect(overview.firstElementChild?.getAttribute("data-slot")).toBe("trips-todo-card");
    expect(region.compareDocumentPosition(container.querySelector("[data-slot=metric-strip]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(within(region).getByRole("button", { name: "Close the summary" }));
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show summary" }).closest("[data-summary=closed]")).toBeTruthy();

    unmount();
    renderWith({ ...SUMMARY, notice: MONDAY }, testUsage(), ME);
    await screen.findByRole("button", { name: "Show summary" });
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show summary" }));
    expect((await screen.findByRole("region", { name: "Summary" })).textContent).toContain("6 activities started this week");
  });

  it("on a day it is not due shows only the counted line under the tiles, with Show summary (#667)", async () => {
    localStorage.clear();
    const { container } = renderWith(
      { ...SUMMARY, closedMissing: { fuel: null, km: 2 }, notice: { ...MONDAY, today: "2026-10-09", scheduledToday: null } },
      testUsage(),
      ME,
    );
    const show = await screen.findByRole("button", { name: "Show summary" });
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    const counted = container.querySelector("[data-slot=trips-counted]") as HTMLElement;
    expect(counted.textContent).toBe("Fuel is not counted: Money is off.");
    expect(counted.closest("[data-summary=closed]")).toBe(show.closest("[data-summary=closed]"));
    // Open, the warning goes with it, inside the notice.
    await userEvent.click(show);
    const region = await screen.findByRole("region", { name: "Summary" });
    expect(within(region).getByText("Fuel is not counted: Money is off.")).toBeTruthy();
  });

  it("says fuel is not counted while Money is off at rest, with no tap", async () => {
    const { container } = renderWith({ ...SUMMARY, closedMissing: { fuel: null, km: 2 } });
    await screen.findByText("2 without km");
    const counted = container.querySelector("[data-slot=trips-counted]") as HTMLElement;
    expect(counted.textContent).toBe("Fuel is not counted: Money is off.");
    expect(counted.closest("[data-slot=trips-overview]")).toBeTruthy();
    expect(counted.closest("[data-slot=info-popover]")).toBeNull();
    // The tile's info says it again, with what is still checked.
    const tile = container.querySelector("[data-metric=incomplete]") as HTMLElement;
    await userEvent.click(within(tile).getByRole("button", { name: "How this is calculated" }));
    expect((await screen.findByText(/fuel is not counted: Money is off/)).textContent).toContain("Km are checked");
  });

  it("says nothing about fuel while Money is on", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("3 without fuel · 2 without km");
    expect(container.querySelector("[data-slot=trips-counted]")).toBeNull();
    expect(screen.queryByText(/not counted: Money is off/)).toBeNull();
  });
});
