import type { ModuleCode, Role } from "@routiq/contracts";
import { canApproveEntries, canReadFinance, canReadFinanceEntries } from "../finance/permissions.js";
import { contributes } from "../modules/manifest.js";

export type DashboardCardKey =
  | "pendingApprovals"
  | "assets"
  | "openPeriodExpense"
  | "openPeriodRevenue";

/** Home's panels under the tiles. */
export const HOME_PANEL_KEYS = ["moneyChart", "recentEntries"] as const;
export type HomePanelKey = (typeof HOME_PANEL_KEYS)[number];

/** What Home holds that a module can own: the tiles and the panels. */
export type HomeCardKey = DashboardCardKey | HomePanelKey;

interface DashboardCardGate {
  key: DashboardCardKey;
  /**
   * Extra role gate for cards whose target screen is itself role-gated. Absent
   * means the owning module alone decides (its manifest names the card).
   */
  role?: (role: Role | undefined, enabledModules: readonly ModuleCode[]) => boolean;
}

/**
 * Same rule as the sidebar: a card is absent, never greyed. The approvals card
 * carries an approver's to-do list and links to the approver-only queue, so it
 * also asks the role — offering a count that leads to a denial screen would be
 * worse than not offering it.
 */
const ALL_CARDS: DashboardCardGate[] = [
  { key: "pendingApprovals", role: canApproveEntries },
  { key: "assets" },
  { key: "openPeriodExpense", role: canReadFinance },
  { key: "openPeriodRevenue", role: canReadFinance },
];

/** Everything Home has, in order; the module manifests name theirs from these. */
export const HOME_CARD_KEYS: readonly HomeCardKey[] = [...ALL_CARDS.map((card) => card.key), ...HOME_PANEL_KEYS];

/** While membership is loading no card can be justified, so none render. */
export function visibleDashboardCards(
  role: Role | undefined,
  enabledModules: ModuleCode[] | undefined,
): DashboardCardKey[] {
  if (enabledModules === undefined) return [];
  return ALL_CARDS.filter(
    (card) =>
      contributes("homeCards", card.key, enabledModules) &&
      (card.role === undefined || card.role(role, enabledModules)),
  ).map((card) => card.key);
}

/**
 * Home's panels this role gets: the expense and revenue chart sums the books
 * (ledger readers); the recent entries are whatever slice the entries read
 * returns this role (#264).
 */
export function visibleHomePanels(
  role: Role | undefined,
  enabledModules: ModuleCode[] | undefined,
): HomePanelKey[] {
  if (enabledModules === undefined) return [];
  const roleAllows: Record<HomePanelKey, boolean> = {
    moneyChart: canReadFinance(role, enabledModules),
    recentEntries: canOpenEntriesList(role, enabledModules),
  };
  return HOME_PANEL_KEYS.filter((key) => contributes("homeCards", key, enabledModules) && roleAllows[key]);
}

/**
 * Whether the open-period totals may link through to the entries list: the
 * gate the entries screen itself applies. The totals are for the ledger
 * readers only (`canReadFinance`), and every one of them reads entries.
 */
export function canOpenEntriesList(
  role: Role | undefined,
  enabledModules: ModuleCode[] | undefined,
): boolean {
  return canReadFinanceEntries(role, enabledModules);
}
