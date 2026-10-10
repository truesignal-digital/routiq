// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
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

function renderWith(summary: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 })));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TripsOverview />
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
    expect(linkOf("This week")).toBe("/activities/list?from=2026-10-05&to=2026-10-11");
    expect(linkOf("On the road")).toBe("/activities/list?status=OPEN");
    expect(linkOf("Closed with missing data")).toBe("/activities/list?completeness=COMPLETE_WITH_EXCEPTIONS");
    expect(screen.getByText("1,840 km")).toBeTruthy();
  });

  it("draws twelve weeks, each column a link to its week", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("3 without fuel · 2 without km");
    const columns = container.querySelectorAll("[data-slot=week-column] a");
    expect(columns).toHaveLength(12);
    expect(columns[11]?.getAttribute("href")).toBe(`/activities/list?from=${WEEKS[11]!.from}&to=${WEEKS[11]!.to}`);
    expect(columns[11]?.getAttribute("aria-label")).toContain("12 started, 11 closed");
  });

  it("lists what is left to close, one button each", async () => {
    const { container } = renderWith(SUMMARY);
    await screen.findByText("5 still open");
    const todo = within(container.querySelector("[data-slot=to-do-list]") as HTMLElement);
    expect(todo.getByText("Oldest: DLA-2026-00031 on VH006, started 10/6/26")).toBeTruthy();
    expect(todo.getByText("3 closed without fuel")).toBeTruthy();
    expect(todo.getByText("2 closed without km")).toBeTruthy();
    const buttons = todo.getAllByRole("link", { name: "Open the list" }).map((link) => link.getAttribute("href"));
    expect(buttons).toEqual([
      "/activities/list?status=OPEN",
      "/activities/list?missing=fuel",
      "/activities/list?missing=km",
    ]);
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

  it("puts the summary notice over the tiles: hidden on a plain day, the week in whole sentences when shown (#667)", async () => {
    renderWith({ ...SUMMARY, notice: { today: "2026-10-09", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] } });
    const counted = await screen.findByText("Closed activities missing data: 3 without fuel and 2 without km.");
    expect(counted.closest("[data-summary=closed]")).toBeTruthy();
    screen.getByRole("button", { name: "Show summary" }).click();
    const region = await screen.findByRole("region", { name: "Summary" });
    expect(region.textContent).toContain("6 activities started this week; 4 of them closed.");
    expect(region.textContent).toContain("5 activities are still open.");
  });
});
