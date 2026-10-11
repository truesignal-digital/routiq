import type { ModuleCode, Role } from "@routiq/contracts";
import { canApproveEntries, canReadFinanceEntries, canReadMoneyOverview } from "./permissions.js";

/** The Money page's tabs, Overview first (dashboards.html#rule). */
export const MONEY_TABS = ["overview", "entries", "approve"] as const;
export type MoneyTab = (typeof MONEY_TABS)[number];

export const MONEY_TAB_PATH = {
  overview: "/finance",
  entries: "/finance/entries",
  approve: "/finance/approve",
} as const satisfies Record<MoneyTab, string>;

/**
 * Which tab the address is on. Recording an entry opens its panel over
 * Entries, so `/finance/record` is the Entries tab.
 */
export function activeMoneyTab(pathname: string): MoneyTab {
  const segment = pathname.split("/").filter(Boolean)[1];
  if (segment === "approve") return "approve";
  if (segment === "entries" || segment === "record") return "entries";
  return "overview";
}

/**
 * role-config: the tabs this viewer may use. Overview for the roles the
 * overview read serves, To approve for the deciders; hidden, never greyed.
 */
export function visibleMoneyTabs(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): MoneyTab[] {
  return MONEY_TABS.filter((tab) => moneyTabShown(tab, role, enabledModules));
}

export function moneyTabShown(
  tab: MoneyTab,
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  switch (tab) {
    case "overview":
      return canReadMoneyOverview(role, enabledModules);
    case "entries":
      return canReadFinanceEntries(role, enabledModules);
    case "approve":
      return canApproveEntries(role, enabledModules);
  }
}
