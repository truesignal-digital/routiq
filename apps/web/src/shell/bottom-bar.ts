import type { ModuleCode, Role } from "@routiq/contracts";
import { visibleSections, type ShellSection } from "./sections.js";

/**
 * role-config: the three places each role uses most, in thumb reach on a
 * phone (#318). Keys of rows in `sections.ts`, so a place passes the same
 * module and role checks as its sidebar row and disappears with it.
 * The driver's middle place becomes "My truck" once a login links to its
 * person (#266); until then it is Trucks.
 */
export const BOTTOM_BAR_PLACES: Record<Role, readonly string[]> = {
  DIRECTOR: ["home", "assets", "finances"],
  ADMIN: ["home", "assets", "finances"],
  FINANCE: ["home", "finances", "assets"],
  CASHIER: ["home", "finances", "assets"],
  TECHNICIAN: ["home", "maintenance", "assets"],
  DRIVER: ["home", "assets", "activities"],
};

/** The places this role gets on the bar, in the table's order; Home alone while the role loads. */
export function bottomBarPlaces(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): ShellSection[] {
  const rows = visibleSections(role, enabledModules);
  const keys = role === undefined ? ["home"] : BOTTOM_BAR_PLACES[role];
  return keys.flatMap((key) => rows.filter((row) => row.key === key));
}
