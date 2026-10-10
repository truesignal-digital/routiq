import type { OverviewRange } from "@routiq/contracts";

/** The Dashboard's tabs, Overview first (dashboards.html#rule). */
export const DASHBOARD_TABS = ["overview", "todo", "vehicles", "branches"] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const DASHBOARD_TAB_PATH = {
  overview: "/",
  todo: "/to-do",
  vehicles: "/profit-by-vehicle",
  branches: "/profit-by-branch",
} as const satisfies Record<DashboardTab, string>;

/** Which tab the address is on; anything else under Home is the Overview. */
export function activeDashboardTab(pathname: string): DashboardTab {
  const found = DASHBOARD_TABS.find((tab) => tab !== "overview" && pathname.startsWith(DASHBOARD_TAB_PATH[tab]));
  return found ?? "overview";
}

/** The range picker's choices as the address spells them; this month is no parameter at all. */
export const DASHBOARD_RANGE_PARAMS = ["3-months", "12-months"] as const;
export type DashboardRangeParam = (typeof DASHBOARD_RANGE_PARAMS)[number];

export function rangeFromParam(param: DashboardRangeParam | undefined): OverviewRange {
  return param === "3-months" ? "THREE_MONTHS" : param === "12-months" ? "TWELVE_MONTHS" : "THIS_MONTH";
}

/**
 * The range the money tabs share, kept when moving between tabs. To do
 * ignores it (it counts the whole Branch Scope, today) but keeps it in its
 * address, so coming back from To do lands on the same range.
 */
export function dashboardTabSearch(range: DashboardRangeParam | undefined): { range?: DashboardRangeParam } {
  return range === undefined ? {} : { range };
}
