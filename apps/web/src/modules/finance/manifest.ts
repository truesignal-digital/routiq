import { Banknote, Calendar, SlidersHorizontal } from "lucide-react";
import { moneyReadScope } from "@routiq/contracts";
import { canManagePeriods, canReadFinanceEntries } from "../../finance/permissions.js";
import { canManageCompanySettings } from "../../settings/permissions.js";
import type { WebModuleManifest } from "../manifest.js";

/**
 * Money: entries, their approval, accounting months and every total or cost
 * built from them (contract: `MODULE_MANIFESTS` in `@routiq/contracts`).
 */
export const financeManifest: WebModuleManifest = {
  code: "FINANCE",
  navRows: [
    {
      key: "finances",
      group: "daily",
      place: { after: "maintenance" },
      labelKey: "finance.entries.title",
      to: "/finance/entries",
      match: "/finance",
      icon: Banknote,
      // A driver reads only the entries they recorded, on their truck and trips.
      reads: (role, enabledModules) =>
        canReadFinanceEntries(role, enabledModules) && moneyReadScope(role) !== "OWN_ENTRIES",
      // The approvals route opens the waiting view (#314), across every branch
      // the count covers.
      count: {
        key: "moneyWaiting",
        labelKey: "shell.counts.moneyWaiting",
        to: "/finance/approvals",
        search: { branch: "all" },
      },
    },
    {
      key: "accountingMonths",
      group: "company",
      place: { after: "branches" },
      labelKey: "finance.periods.title",
      to: "/finance/periods",
      icon: Calendar,
      // The roles that lock a month; the page is theirs alone (#314).
      reads: canManagePeriods,
    },
    {
      key: "companySettings",
      group: "company",
      place: { after: "accountingMonths" },
      labelKey: "settings.title",
      to: "/more/company",
      icon: SlidersHorizontal,
      // The approval chain is its only section so far (#354).
      reads: canManageCompanySettings,
    },
  ],
  navCounts: [{ key: "moneyWaiting", listKey: (slug) => ["ws", slug, "finance", "approvals"] }],
  homeCards: ["pendingApprovals", "openPeriodExpense", "openPeriodRevenue", "moneyChart", "recentEntries"],
  vehicleTabs: ["money"],
  vehicleActions: ["log-fuel", "record-expense", "attach-evidence", "record-revenue", "review-entry", "reverse-entry"],
  recordPanels: ["entry"],
  historyKinds: ["MONEY"],
  fields: ["trip.money"],
};
