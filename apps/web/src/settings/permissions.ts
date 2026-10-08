import type { ModuleCode, Role } from "@routiq/contracts";

/**
 * Company settings are Direction's alone (ADR-0009, #354): the only section so
 * far is the money chain, which means nothing with the Finance module off, so
 * the entry goes with it rather than leading to an empty page (§3.3a).
 */
export function canManageCompanySettings(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return role === "DIRECTOR" && (enabledModules ?? []).includes("FINANCE");
}
