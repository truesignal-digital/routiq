import type { Role } from "@routiq/contracts";

/**
 * Company settings are Direction's alone (ADR-0009, #354). The page holds the
 * money chain and the Dashboard summary schedule (#669); it still belongs to
 * Finance's manifest and goes with the module (§3.3a), which every preset
 * turns on.
 */
export function canManageCompanySettings(role: Role | undefined): boolean {
  return role === "DIRECTOR";
}
