import type { ModuleCode, Role } from "@routiq/contracts";
import { canManagePeriods, canRecordFinance } from "./permissions.js";

export type FinanceSectionKey = "record" | "entries" | "approvals" | "periods";

export interface FinanceSection {
  key: FinanceSectionKey;
  to:
    | "/finance/record"
    | "/finance/entries"
    | "/finance/approvals"
    | "/finance/periods";
}

const FINANCE_SECTIONS: readonly FinanceSection[] = [
  { key: "record", to: "/finance/record" },
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
