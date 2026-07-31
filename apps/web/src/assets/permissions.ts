import type { ModuleCode, Role } from "@routiq/contracts";
import { isReadOnlyRole } from "../auth/me.js";

/** Reading the fleet is open to every role; the module flag is the only gate. */
export function canViewAssets(
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return enabledModules?.includes("ASSETS") ?? false;
}

/** Registering and acting on an asset. Viewer roles see no such affordance. */
export function canManageAssets(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewAssets(enabledModules)) return false;
  return !isReadOnlyRole(role);
}
