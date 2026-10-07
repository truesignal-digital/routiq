import {
  Banknote,
  Building,
  Calendar,
  House,
  Menu,
  Route,
  ShieldUser,
  SlidersHorizontal,
  Truck,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { moneyReadScope, type ModuleCode, type Role } from "@routiq/contracts";
import { canAdministerBranches } from "../branches/permissions.js";
import { canManagePeriods, canReadFinanceEntries } from "../finance/permissions.js";
import { isRouteActive } from "../lib/route-match.js";
import { canAdministerMembers } from "../members/permissions.js";
import { canManageCompanySettings } from "../settings/permissions.js";

/** The sidebar's groups, in order: the work of the day, then the company's own set-up. */
export const SECTION_GROUPS = [
  { key: "daily", labelKey: "shell.groups.daily" },
  { key: "company", labelKey: "shell.groups.company" },
] as const;

export type SectionGroupKey = (typeof SECTION_GROUPS)[number]["key"];

export interface ShellSection {
  key: string;
  group: SectionGroupKey;
  /**
   * The page title key of the route `to` opens. The row, the page header and
   * the first crumb after Home all read it, so the three never disagree.
   */
  labelKey: string;
  /** Where the nav entry navigates. */
  to: string;
  /** Route subtree the section owns; defaults to `to` for single-route sections. */
  match?: string;
  /** The consistency kit's icon for the place (`docs/design/consistency/kit.js`, ICONS). */
  icon: LucideIcon;
  /** Module that owns this section; sections without one are always visible. */
  module?: ModuleCode;
  /**
   * role-config: whether this role has work on the page. Absent means every
   * role; a row with one stays hidden until the role is known.
   */
  reads?: (role: Role, enabledModules: readonly ModuleCode[]) => boolean;
}

const onlyFor =
  (roles: readonly Role[]) =>
  (role: Role): boolean =>
    roles.includes(role);

/**
 * Every row, in sidebar order within its group. A row is a place (a page of
 * records), never an action or a single record. Rows hide when their module
 * is off or the role has no work there; they are never greyed (#64).
 */
const ALL_SECTIONS: readonly ShellSection[] = [
  // The landing route, and the one section every member keeps: its cards are
  // module-gated individually, so the page is never empty of everything.
  { key: "home", group: "daily", labelKey: "home.title", to: "/", icon: House },
  { key: "assets", group: "daily", labelKey: "assets.title", to: "/assets", icon: Truck, module: "ASSETS" },
  {
    key: "activities",
    group: "daily",
    labelKey: "activities.title",
    to: "/activities",
    icon: Route,
    module: "ACTIVITIES",
    // The counter and the workshop have no trips to run (ADR-0009).
    reads: onlyFor(["DIRECTOR", "ADMIN", "FINANCE", "DRIVER"]),
  },
  {
    key: "maintenance",
    group: "daily",
    labelKey: "maintenance.title",
    to: "/maintenance",
    icon: Wrench,
    module: "MAINTENANCE",
    reads: onlyFor(["DIRECTOR", "ADMIN", "TECHNICIAN"]),
  },
  {
    key: "finances",
    group: "daily",
    labelKey: "finance.entries.title",
    to: "/finance/entries",
    match: "/finance",
    icon: Banknote,
    module: "FINANCE",
    // A driver reads only the entries they recorded, on their truck and trips.
    reads: (role, enabledModules) =>
      canReadFinanceEntries(role, enabledModules) && moneyReadScope(role) !== "OWN_ENTRIES",
  },
  { key: "more", group: "daily", labelKey: "more.title", to: "/more", icon: Menu },
  {
    key: "persons",
    group: "company",
    labelKey: "persons.title",
    to: "/more/persons",
    icon: UserRound,
    module: "ACTIVITIES",
    reads: onlyFor(["DIRECTOR", "ADMIN", "FINANCE"]),
  },
  {
    key: "users",
    group: "company",
    labelKey: "users.title",
    to: "/more/users",
    icon: ShieldUser,
    reads: canAdministerMembers,
  },
  {
    key: "branches",
    group: "company",
    labelKey: "branches.title",
    to: "/more/branches",
    icon: Building,
    reads: canAdministerBranches,
  },
  {
    key: "accountingMonths",
    group: "company",
    labelKey: "finance.periods.title",
    to: "/finance/periods",
    icon: Calendar,
    module: "FINANCE",
    // The roles that lock a month; the page is theirs alone (#314).
    reads: canManagePeriods,
  },
  {
    key: "companySettings",
    group: "company",
    labelKey: "settings.title",
    to: "/more/company",
    icon: SlidersHorizontal,
    module: "FINANCE",
    // The approval chain is its only section so far (#354).
    reads: canManageCompanySettings,
  },
];

/**
 * The rows this role sees, in sidebar order. While membership is loading
 * (no modules, no role) only rows with neither a module nor a role rule show.
 */
export function visibleSections(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): ShellSection[] {
  return ALL_SECTIONS.filter((section) => {
    if (section.module !== undefined && !(enabledModules?.includes(section.module) ?? false)) {
      return false;
    }
    if (section.reads === undefined) return true;
    return role !== undefined && enabledModules !== undefined && section.reads(role, enabledModules);
  });
}

export interface SectionGroup {
  key: SectionGroupKey;
  labelKey: string;
  sections: ShellSection[];
}

/** `visibleSections`, split into the sidebar's groups; a group with no rows is left out. */
export function visibleSectionGroups(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): SectionGroup[] {
  const sections = visibleSections(role, enabledModules);
  return SECTION_GROUPS.flatMap(({ key, labelKey }) => {
    const rows = sections.filter((section) => section.group === key);
    return rows.length === 0 ? [] : [{ key, labelKey, sections: rows }];
  });
}

/** Whole-segment exact-or-child match over the subtree the section owns. */
export function isSectionActive(section: ShellSection, pathname: string): boolean {
  return isRouteActive(section.match ?? section.to, pathname);
}

/**
 * The one section owning `pathname`, or undefined outside every section. The
 * deepest match wins, so `/more/users` belongs to Users, not to More.
 */
export function activeSection(
  sections: readonly ShellSection[],
  pathname: string,
): ShellSection | undefined {
  const owners = sections.filter((section) => isSectionActive(section, pathname));
  return owners.sort((a, b) => (b.match ?? b.to).length - (a.match ?? a.to).length)[0];
}
