import type { ModuleCode, Role } from "@routiq/contracts";

/** Reading the fleet is open to every role; the module flag is the only gate. */
export function canViewAssets(
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return enabledModules?.includes("ASSETS") ?? false;
}

function assetRole(
  roles: readonly Role[],
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canViewAssets(enabledModules) && role !== undefined && roles.includes(role);
}

const FLEET_MANAGERS: readonly Role[] = ["DIRECTOR", "ADMIN"];

/** Registering a vehicle and editing what it is (register-asset, update-asset-details). */
export function canManageAssets(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return assetRole(FLEET_MANAGERS, role, enabledModules);
}

/** Naming who answers for the vehicle day to day: a manager's call (assign-asset). */
export function canAssignCustodian(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return assetRole(FLEET_MANAGERS, role, enabledModules);
}

/**
 * Moving the vehicle's home branch. Finance holds the cross-branch rule, so it
 * may start a transfer too.
 */
export function canTransferAsset(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return assetRole(["DIRECTOR", "ADMIN", "FINANCE"], role, enabledModules);
}

/** Putting a registered vehicle into service. */
export function canCommissionAsset(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return assetRole(FLEET_MANAGERS, role, enabledModules);
}
