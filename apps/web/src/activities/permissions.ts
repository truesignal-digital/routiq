import type { ModuleCode, Role } from "@routiq/contracts";

/** Reading jobs is open to every role; the module flag is the only gate. */
export function canViewActivities(
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return enabledModules?.includes("ACTIVITIES") ?? false;
}

const TRIP_RECORDERS: readonly Role[] = ["DIRECTOR", "ADMIN", "DRIVER"];

/** Recording and closing trips: the managers and the drivers who run them. */
export function canRecordActivities(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewActivities(enabledModules)) return false;
  return role !== undefined && TRIP_RECORDERS.includes(role);
}

/**
 * A revenue line on a trip sheet: the sheet's recorders but the driver, who
 * records expenses only and does not see trip prices (#532). The server
 * refuses it with ROLE_FORBIDDEN, as it refuses record-revenue.
 */
export function canRecordSheetRevenue(role: Role | undefined): boolean {
  return role === "DIRECTOR" || role === "ADMIN";
}

/**
 * Closing a trip and swapping its vehicle: a trip recorder, but a DRIVER only
 * on the trips they recorded (server: OWN_RECORDS_ONLY).
 */
export function canCloseActivity(
  me: { role: Role; principalId: string } | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
  activity: { recordedByPrincipalId: string | null },
): boolean {
  if (!canRecordActivities(me?.role, enabledModules)) return false;
  return me?.role !== "DRIVER" || activity.recordedByPrincipalId === me.principalId;
}

/** Reopening a closed job — §5.1 gives it one approval, i.e. a manager. */
export function canReopenActivity(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewActivities(enabledModules)) return false;
  return role === "DIRECTOR" || role === "ADMIN";
}

const READING_RECORDERS: readonly Role[] = ["DIRECTOR", "ADMIN", "TECHNICIAN", "DRIVER"];

/**
 * A standalone meter reading. The workshop reads the odometer when a truck
 * comes in, so TECHNICIAN may record one although it records no trips.
 */
export function canRecordReadings(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewActivities(enabledModules)) return false;
  return role !== undefined && READING_RECORDERS.includes(role);
}

/** Adding a person to Personnel (register-person): the managers only. */
export function canRegisterPersons(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canReopenActivity(role, enabledModules);
}
