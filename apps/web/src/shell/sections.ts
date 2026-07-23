import { Menu, Truck, type LucideIcon } from "lucide-react";

/**
 * Stub section list — ticket 04 replaces this with the server-driven
 * enabled-modules view (§3.3a). Nothing outside the shell may import it.
 */
export interface ShellSection {
  key: "assets" | "more";
  to: string;
  icon: LucideIcon;
}

export const shellSections: ShellSection[] = [
  { key: "assets", to: "/assets", icon: Truck },
  { key: "more", to: "/more", icon: Menu },
];
