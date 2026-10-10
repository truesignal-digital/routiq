import type { Role } from "@routiq/contracts";

/**
 * Company settings are Direction's alone (ADR-0009, #354). The only section so
 * far is the money chain, which means nothing with the Finance module off, so
 * the page belongs to Finance's manifest and goes with the module (§3.3a).
 */
export function canManageCompanySettings(role: Role | undefined): boolean {
  return role === "DIRECTOR";
}
