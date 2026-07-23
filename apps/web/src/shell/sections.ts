import { Menu, Truck, type LucideIcon } from "lucide-react";
import type { ModuleCode } from "@asset/contracts";

export interface ShellSection {
  key: "assets" | "more";
  to: string;
  icon: LucideIcon;
  /** Module that owns this section; sections without one are always visible. */
  module?: ModuleCode;
}

const ALL_SECTIONS: ShellSection[] = [
  { key: "assets", to: "/assets", icon: Truck, module: "ASSETS" },
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
