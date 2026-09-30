import type { ModuleCode, Role } from "@routiq/contracts";

/** Reading jobs is open to every role; the module flag is the only gate. */
export function canViewActivities(
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return enabledModules?.includes("ACTIVITIES") ?? false;
}

/** Recording and closing trips. EXECUTIVE_VIEWER sees no submit affordances. */
export function canRecordActivities(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewActivities(enabledModules)) return false;
  return role === "ADMIN" || role === "OPS_MANAGER" || role === "FIELD_SUBMITTER";
}

/** Reopening a closed job — §5.1 gives it one approval, i.e. a manager. */
export function canReopenActivity(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewActivities(enabledModules)) return false;
  return role === "ADMIN" || role === "OPS_MANAGER";
}

/**
 * A standalone meter reading. The workshop reads the odometer when a truck
 * comes in, so MAINTENANCE may record one although it records no trips.
 */
export function canRecordReadings(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewActivities(enabledModules)) return false;
  return (
    role === "ADMIN" ||
    role === "OPS_MANAGER" ||
    role === "FIELD_SUBMITTER" ||
    role === "MAINTENANCE"
  );
}
