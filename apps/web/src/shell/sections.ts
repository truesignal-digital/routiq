import { DollarSign, House, Menu, Truck, type LucideIcon } from "lucide-react";
import type { ModuleCode } from "@routiq/contracts";
import { isRouteActive } from "../lib/route-match.js";

export interface ShellSection {
  key: "home" | "assets" | "finances" | "more";
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
