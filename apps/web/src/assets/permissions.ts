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

function assetRole(
  roles: readonly Role[],
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canViewAssets(enabledModules) && role !== undefined && roles.includes(role);
}

/** Naming who answers for the vehicle day to day: a manager's call (assign-asset). */
export function canAssignCustodian(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return assetRole(["ADMIN", "OPS_MANAGER"], role, enabledModules);
}

/**
 * Moving the vehicle's home branch. The finance approver holds the cross-branch
 * rule, so it may start a transfer too.
 */
export function canTransferAsset(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return assetRole(["ADMIN", "OPS_MANAGER", "FINANCE_APPROVER"], role, enabledModules);
}

/** Putting a registered vehicle into service. */
export function canCommissionAsset(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return assetRole(["ADMIN", "OPS_MANAGER"], role, enabledModules);
}
