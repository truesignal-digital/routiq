import { canReadWorkOrderCosts, type ModuleCode, type Role } from "@routiq/contracts";

/** Reading the workshop queue is open to every role; the module flag gates it. */
export function canViewMaintenance(
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return enabledModules?.includes("MAINTENANCE") ?? false;
}

/**
 * A work order's estimate, actual cost and cost lines: every role but the
 * driver (#390). The server sends null to the others; this only decides how
 * the screen words a figure it never received.
 */
export function canSeeWorkOrderCosts(role: Role | undefined): boolean {
  return role !== undefined && canReadWorkOrderCosts(role);
}

/**
 * Each list mirrors the default approval rules the core pack seeds
 * (`apps/api/src/provisioning/packs/core.ts`). The server authorizes either
 * way; hiding a control a member cannot use keeps the sheet from offering
 * decisions that can only come back 403.
 */
const ISSUE_REPORTERS: readonly Role[] = ["DIRECTOR", "ADMIN", "TECHNICIAN", "DRIVER"];

/** Closing a signalement as dealt with, or overruling it, is the workshop's and the managers' call. */
const ISSUE_RESOLVERS: readonly Role[] = ["DIRECTOR", "ADMIN", "TECHNICIAN"];

const ISSUE_DISMISSERS: readonly Role[] = ["DIRECTOR", "ADMIN", "TECHNICIAN"];

/**
 * Taking the safety-critical mark off a problem overrules a report that called
 * the vehicle unsafe: the managers' call (#96). Adding it is open to whoever
 * reports problems.
 */
const SEVERITY_LOWERERS: readonly Role[] = ["DIRECTOR", "ADMIN"];

const WORK_ORDER_WRITERS: readonly Role[] = ["DIRECTOR", "ADMIN", "TECHNICIAN"];

/**
 * The work-order decisions — both approvals and both refusals — sit with the
 * Administrateur (ADR-0009: work orders → Administrateur, money → Finance).
 */
const WORK_ORDER_APPROVERS: readonly Role[] = ["DIRECTOR", "ADMIN"];

/** Putting a truck back on the road is a manager's call, never the workshop's. */
const ASSET_RELEASERS: readonly Role[] = ["DIRECTOR", "ADMIN"];

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

export function canResolveIssues(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(ISSUE_RESOLVERS, role, enabledModules);
}

export function canDismissIssues(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(ISSUE_DISMISSERS, role, enabledModules);
}

/** Marking an open problem safety-critical after it was reported (#96). */
export function canRaiseIssueSeverity(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(ISSUE_REPORTERS, role, enabledModules);
}

/** Taking the safety-critical mark off an open problem (#96). */
export function canLowerIssueSeverity(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(SEVERITY_LOWERERS, role, enabledModules);
}

/** Opening, declaring completion on, and cancelling a work order. */
export function canManageWorkOrders(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return allowed(WORK_ORDER_WRITERS, role, enabledModules);
}

/** Approving or rejecting a work order, and approving or rejecting its completion. */
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
