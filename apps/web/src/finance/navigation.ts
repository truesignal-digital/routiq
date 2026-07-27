import type { ModuleCode, Role } from "@routiq/contracts";
import { isRouteActive } from "../lib/route-match.js";
import { canManagePeriods, canRecordFinance } from "./permissions.js";

export type FinanceSectionKey = "entries" | "approvals" | "periods";

export interface FinanceSection {
  key: FinanceSectionKey;
  to: "/finance/entries" | "/finance/approvals" | "/finance/periods";
}

/**
 * Recording is reached through the « Saisir une écriture » action on the
 * entries screen, not a tab — so /finance/record activates none of these.
 */
const FINANCE_SECTIONS: readonly FinanceSection[] = [
  { key: "entries", to: "/finance/entries" },
  { key: "approvals", to: "/finance/approvals" },
  { key: "periods", to: "/finance/periods" },
];

export function visibleFinanceSections(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): FinanceSection[] {
  if (!canRecordFinance(role, enabledModules)) return [];

  const canManage = canManagePeriods(role, enabledModules);

  return FINANCE_SECTIONS.filter(({ key }) => {
    if (key === "approvals" || key === "periods") return canManage;
    return true;
  });
}

/**
 * The section owning `pathname`, or undefined outside finance. Child routes
 * count, so `/finance/entries/<id>` keeps Écritures lit; the four section
 * paths are siblings, so at most one can match.
 */
export function activeFinanceSection(
  sections: readonly FinanceSection[],
  pathname: string,
): FinanceSection | undefined {
  return sections.find((section) => isRouteActive(section.to, pathname));
}
