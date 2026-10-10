import type { ModuleCode, Role } from "@routiq/contracts";
import { visibleSections } from "./sections.js";

/**
 * role-config: where a role opens (dashboards.html#roles). The technician
 * opens on the Maintenance Overview, the workshop's own page, whenever the
 * shell shows them that page; everyone else opens on Home.
 */
export function roleLanding(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): "/" | "/maintenance" {
  if (role === "TECHNICIAN" && visibleSections(role, enabledModules).some((section) => section.key === "maintenance")) {
    return "/maintenance";
  }
  return "/";
}
