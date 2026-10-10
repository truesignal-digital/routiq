import { Building, House, ShieldUser, type LucideIcon } from "lucide-react";
import type { ModuleCode, NavCountKey, Role, ToggleableModuleCode } from "@routiq/contracts";
import { canAdministerBranches } from "../branches/permissions.js";
import { isRouteActive } from "../lib/route-match.js";
import { canAdministerMembers } from "../members/permissions.js";
import { moduleNavRows } from "../modules/manifest.js";

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
  /**
   * The module whose manifest adds this row (`src/modules/`); core's rows have
   * none and are always there. Set from the manifest, never written on a row.
   */
  module?: ToggleableModuleCode;
  /**
   * role-config: whether this role has work on the page. Absent means every
   * role; a row with one stays hidden until the role is known.
   */
  reads?: (role: Role, enabledModules: readonly ModuleCode[]) => boolean;
  /**
   * Work on this page that waits on the viewer (#322): which server count the
   * row shows, its accessible label, and the filtered view the count opens.
   */
  count?: SectionCount;
}

export interface SectionCount {
  key: NavCountKey;
  /** ICU plural over `{count}`, said by screen readers and the collapsed rail's tooltip. */
  labelKey: string;
  to: string;
  search: Record<string, string>;
}

/**
 * Core's rows, in sidebar order within its group; every module adds its own
 * through its manifest (`allSections`). A row is a place (a page of records),
 * never an action or a single record. Rows hide when their module is off or
 * the role has no work there; they are never greyed (#64).
 */
const CORE_SECTIONS: readonly Omit<ShellSection, "module">[] = [
  // The landing route, and the one section every member keeps: its cards are
  // module-gated individually, and with none it says why (#622).
  { key: "home", group: "daily", labelKey: "home.title", to: "/", icon: House },
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
];

/** Core's rows keys, for the manifest checks. */
export const CORE_SECTION_KEYS: readonly string[] = CORE_SECTIONS.map((section) => section.key);

/** Every row, core's and the installed modules', each module row placed beside the row it names. */
export function allSections(): ShellSection[] {
  const rows: ShellSection[] = [...CORE_SECTIONS];
  let pending = moduleNavRows();
  // A row may be placed by another module's row, so keep placing until none moves.
  while (pending.length > 0) {
    const waiting = pending.filter(({ place, ...row }) => {
      const anchor = "after" in place ? place.after : place.before;
      const index = rows.findIndex((placed) => placed.key === anchor);
      if (index === -1) return true;
      rows.splice("after" in place ? index + 1 : index, 0, row);
      return false;
    });
    if (waiting.length === pending.length) {
      // An anchor that does not exist (the manifest checks name it): last.
      rows.push(...waiting.map(({ place: _place, ...row }) => row));
      break;
    }
    pending = waiting;
  }
  return rows;
}

/**
 * The rows this role sees, in sidebar order. While membership is loading
 * (no modules, no role) only rows with neither a module nor a role rule show.
 */
export function visibleSections(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): ShellSection[] {
  return allSections().filter((section) => {
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
