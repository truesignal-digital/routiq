import { COMING_UP_READER_ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { contributes, PAGE_TABS } from "@/modules/manifest.js";

/** The Trucks page's tabs, Overview first (dashboards.html#rule). */
export const TRUCKS_TABS = ["overview", "list", "documents"] as const;
export type TrucksTab = (typeof TRUCKS_TABS)[number];

export const TRUCKS_TAB_PATH = {
  overview: "/assets",
  list: "/assets/list",
  documents: PAGE_TABS["assets.documents"].to,
} as const satisfies Record<TrucksTab, string>;

export function activeTrucksTab(pathname: string): TrucksTab {
  const segment = pathname.split("/").filter(Boolean)[1];
  if (segment === "list") return "list";
  if (segment === "documents") return "documents";
  return "overview";
}

/**
 * role-config: the tabs this viewer may use, hidden never greyed. Documents
 * is the Documents module's tab, read from the fleet's Coming up and To do,
 * so it goes with the module and with the roles those reads serve.
 */
export function visibleTrucksTabs(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): TrucksTab[] {
  return TRUCKS_TABS.filter((tab) => tab !== "documents" || canReadFleetDocuments(role, enabledModules));
}

export function canReadFleetDocuments(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    contributes("pageTabs", "assets.documents", enabledModules) &&
    role !== undefined &&
    (COMING_UP_READER_ROLES as readonly Role[]).includes(role)
  );
}
