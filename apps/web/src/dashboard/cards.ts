import type { ModuleCode, Role } from "@routiq/contracts";
import { canApproveEntries, canReadFinance, canReadFinanceEntries } from "../finance/permissions.js";
import { contributes } from "../modules/manifest.js";

export type DashboardCardKey =
  | "pendingApprovals"
  | "assets"
  | "openPeriodExpense"
  | "openPeriodRevenue";

interface DashboardCardGate {
  key: DashboardCardKey;
  /**
   * Module that owns the card, for cards core still assigns itself; a module's
   * own cards are named in its manifest (`src/modules/`). A disabled module
   * removes its cards entirely (§3.3a).
   */
  module?: ModuleCode;
  /**
   * Extra role gate for cards whose target screen is itself role-gated. Absent
   * means the module alone decides.
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
  {
    key: "pendingApprovals",
    module: "FINANCE",
    role: canApproveEntries,
  },
  { key: "assets", module: "ASSETS" },
  { key: "openPeriodExpense", module: "FINANCE", role: canReadFinance },
  { key: "openPeriodRevenue", module: "FINANCE", role: canReadFinance },
];

/** Every card Home has, in order; the module manifests name theirs from these. */
export const DASHBOARD_CARD_KEYS: readonly DashboardCardKey[] = ALL_CARDS.map((card) => card.key);

/** Cards core still assigns to a module inline; a manifest may not claim them too. */
export const INLINE_OWNED_CARDS: readonly DashboardCardKey[] = ALL_CARDS.flatMap((card) =>
  card.module === undefined ? [] : [card.key],
);

/** While membership is loading no card can be justified, so none render. */
export function visibleDashboardCards(
  role: Role | undefined,
  enabledModules: ModuleCode[] | undefined,
): DashboardCardKey[] {
  if (enabledModules === undefined) return [];
  return ALL_CARDS.filter(
    (card) =>
      contributes("homeCards", card.key, enabledModules) &&
      (card.module === undefined || enabledModules.includes(card.module)) &&
      (card.role === undefined || card.role(role, enabledModules)),
  ).map((card) => card.key);
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
