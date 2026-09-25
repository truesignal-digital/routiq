import type { ModuleCode, Role } from "@routiq/contracts";
import { canApproveEntries, canReadFinance } from "../finance/permissions.js";

export type DashboardCardKey =
  | "pendingApprovals"
  | "assets"
  | "openPeriodExpense"
  | "openPeriodRevenue";

interface DashboardCardGate {
  key: DashboardCardKey;
  /** Module that owns the card; a disabled module removes it entirely (§3.3a). */
  module: ModuleCode;
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
  { key: "openPeriodExpense", module: "FINANCE" },
  { key: "openPeriodRevenue", module: "FINANCE" },
];

/** While membership is loading no card can be justified, so none render. */
export function visibleDashboardCards(
  role: Role | undefined,
  enabledModules: ModuleCode[] | undefined,
): DashboardCardKey[] {
  if (enabledModules === undefined) return [];
  return ALL_CARDS.filter(
    (card) =>
      enabledModules.includes(card.module) &&
      (card.role === undefined || card.role(role, enabledModules)),
  ).map((card) => card.key);
}

/**
 * Whether the open-period totals may link through to the entries list. The
 * numbers themselves stay visible to every finance member — a read-only
 * executive is exactly who they are for — but the link only appears for roles
 * the entries screen actually admits.
 */
export function canOpenEntriesList(
  role: Role | undefined,
  enabledModules: ModuleCode[] | undefined,
): boolean {
  return canReadFinance(role, enabledModules);
}
