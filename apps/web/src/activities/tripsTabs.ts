import { COMING_UP_ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { contributes, PAGE_TABS } from "@/modules/manifest.js";

/** The Trips page's tabs, Overview first (dashboards.html#rule). */
export const TRIPS_TABS = ["overview", "list", "planning"] as const;
export type TripsTab = (typeof TRIPS_TABS)[number];

export const TRIPS_TAB_PATH = {
  overview: "/activities",
  list: "/activities/list",
  planning: PAGE_TABS["activities.planning"].to,
} as const satisfies Record<TripsTab, string>;

export function activeTripsTab(pathname: string): TripsTab {
  const segment = pathname.split("/").filter(Boolean)[1];
  if (segment === "list") return "list";
  if (segment === "planning") return "planning";
  return "overview";
}

/**
 * role-config: the tabs this viewer may use, hidden never greyed. Planning is
 * the Scheduling module's tab, for the planners (the roles Coming up shows
 * planned trips to, ADR-0012 §7).
 */
export function visibleTripsTabs(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): TripsTab[] {
  return TRIPS_TABS.filter((tab) => tab !== "planning" || canReadPlanning(role, enabledModules));
}

export function canReadPlanning(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    contributes("pageTabs", "activities.planning", enabledModules) &&
    role !== undefined &&
    (COMING_UP_ROLES.TRIPS_PLANNED as readonly Role[]).includes(role)
  );
}
