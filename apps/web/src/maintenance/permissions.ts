import type { ModuleCode, Role } from "@routiq/contracts";

/** Reading the workshop queue is open to every role; the module flag gates it. */
export function canViewMaintenance(
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return enabledModules?.includes("MAINTENANCE") ?? false;
}

/**
 * Each list mirrors the default approval rules the core pack seeds
 * (`apps/api/src/provisioning/packs/core.ts`). The server authorizes either
 * way; hiding a control a member cannot use keeps the sheet from offering
 * decisions that can only come back 403.
 */
const ISSUE_REPORTERS: readonly Role[] = [
  "ADMIN",
  "OPS_MANAGER",
  "FIELD_SUBMITTER",
  "MAINTENANCE",
];

const WORK_ORDER_WRITERS: readonly Role[] = ["ADMIN", "OPS_MANAGER", "MAINTENANCE"];

/** The two work-order decisions sit with the finance approver, as approve-entry does. */
const WORK_ORDER_APPROVERS: readonly Role[] = ["FINANCE_APPROVER", "ADMIN"];

/** Putting a truck back on the road is a manager's call, never the workshop's. */
const ASSET_RELEASERS: readonly Role[] = ["ADMIN", "OPS_MANAGER"];

function allowed(
  roles: readonly Role[],
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  if (!canViewMaintenance(enabledModules)) return false;
  return role !== undefined && roles.includes(role);
}

export function canReportIssues(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(ISSUE_REPORTERS, role, enabledModules);
}

/** Opening, declaring completion on, and cancelling a work order. */
export function canManageWorkOrders(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(WORK_ORDER_WRITERS, role, enabledModules);
}

export function canApproveWorkOrders(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(WORK_ORDER_APPROVERS, role, enabledModules);
}

export function canReleaseAssets(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(ASSET_RELEASERS, role, enabledModules);
}
