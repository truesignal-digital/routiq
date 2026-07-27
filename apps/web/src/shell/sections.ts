import { DollarSign, Menu, Truck, type LucideIcon } from "lucide-react";
import type { ModuleCode } from "@routiq/contracts";

export interface ShellSection {
  key: "assets" | "finances" | "more";
  /** Where the nav entry navigates. */
  to: string;
  /** Route subtree the section owns; defaults to `to` for single-route sections. */
  match?: string;
  icon: LucideIcon;
  /** Module that owns this section; sections without one are always visible. */
  module?: ModuleCode;
}

const ALL_SECTIONS: ShellSection[] = [
  { key: "assets", to: "/assets", icon: Truck, module: "ASSETS" },
  {
    key: "finances",
    to: "/finance/entries",
    match: "/finance",
    icon: DollarSign,
    module: "FINANCE",
  },
  { key: "more", to: "/more", icon: Menu },
];

/** Disabled modules remove their sections entirely — absent, not greyed (§3.3a). */
export function visibleSections(enabledModules: ModuleCode[] | undefined): ShellSection[] {
  if (enabledModules === undefined) {
    return ALL_SECTIONS.filter((s) => s.module === undefined);
  }
  return ALL_SECTIONS.filter(
    (s) => s.module === undefined || enabledModules.includes(s.module),
  );
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Whole-segment exact-or-child match. A bare `startsWith` would light up
 * `/assets` for `/assets-archive`, and a section whose `to` is a sibling route
 * would steal its neighbour's highlight.
 */
export function isSectionActive(section: ShellSection, pathname: string): boolean {
  const root = withoutTrailingSlash(section.match ?? section.to);
  const path = withoutTrailingSlash(pathname);
  return path === root || path.startsWith(`${root}/`);
}

/** The one section owning `pathname`, or undefined outside every section. */
export function activeSection(
  sections: ShellSection[],
  pathname: string,
): ShellSection | undefined {
  return sections.find((section) => isSectionActive(section, pathname));
}
