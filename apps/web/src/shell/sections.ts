import {
  DollarSign,
  House,
  Route,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ModuleCode, Role } from "@routiq/contracts";
import { canReadFinanceEntries } from "../finance/permissions.js";
import { isRouteActive } from "../lib/route-match.js";

export interface ShellSection {
  key: "home" | "assets" | "activities" | "maintenance" | "finances";
  /** Where the nav entry navigates. */
  to: string;
  /** Route subtree the section owns; defaults to `to` for single-route sections. */
  match?: string;
  icon: LucideIcon;
  /** Module that owns this section; sections without one are always visible. */
  module?: ModuleCode;
}

const ALL_SECTIONS: ShellSection[] = [
  // The landing route, and the one section every member keeps: its cards are
  // module-gated individually, so the page is never empty of everything.
  { key: "home", to: "/", icon: House },
  { key: "assets", to: "/assets", icon: Truck, module: "ASSETS" },
  {
    key: "activities",
    to: "/activities",
    match: "/activities",
    icon: Route,
    module: "ACTIVITIES",
  },
  {
    key: "maintenance",
    to: "/maintenance",
    match: "/maintenance",
    icon: Wrench,
    module: "MAINTENANCE",
  },
  {
    key: "finances",
    to: "/finance/entries",
    match: "/finance",
    icon: DollarSign,
    module: "FINANCE",
  },
];

/**
 * role-config: sections a role has no work in. The counter (CASHIER) records
 * money and sees vehicles; trips and the workshop are not theirs (ADR-0009).
 */
const HIDDEN_FOR: Partial<Record<Role, ReadonlyArray<ShellSection["key"]>>> = {
  CASHIER: ["activities", "maintenance"],
};

/**
 * Money: the entries for every role that reads some (the ledger, the counter's
 * branch entries, a driver's own); every role that records money is one of
 * them. Nothing for the workshop, which books its costs on work orders.
 */
function financeSection(
  section: ShellSection,
  role: Role,
  enabledModules: readonly ModuleCode[],
): ShellSection | undefined {
  return canReadFinanceEntries(role, enabledModules) ? section : undefined;
}

/**
 * Disabled modules remove their sections entirely — absent, not greyed (§3.3a).
 * With a role, sections that role has no work in go the same way.
 */
export function visibleSections(
  enabledModules: ModuleCode[] | undefined,
  role?: Role,
): ShellSection[] {
  if (enabledModules === undefined) {
    return ALL_SECTIONS.filter((s) => s.module === undefined);
  }
  const byModule = ALL_SECTIONS.filter(
    (s) => s.module === undefined || enabledModules.includes(s.module),
  );
  if (role === undefined) return byModule;
  const hidden = HIDDEN_FOR[role] ?? [];
  return byModule.flatMap((section) => {
    if (hidden.includes(section.key)) return [];
    if (section.key !== "finances") return [section];
    const finance = financeSection(section, role, enabledModules);
    return finance === undefined ? [] : [finance];
  });
}

/** Whole-segment exact-or-child match over the subtree the section owns. */
export function isSectionActive(section: ShellSection, pathname: string): boolean {
  return isRouteActive(section.match ?? section.to, pathname);
}

/** The one section owning `pathname`, or undefined outside every section. */
export function activeSection(
  sections: readonly ShellSection[],
  pathname: string,
): ShellSection | undefined {
  return sections.find((section) => isSectionActive(section, pathname));
}
