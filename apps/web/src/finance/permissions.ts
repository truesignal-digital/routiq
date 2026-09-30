import { canReadLedger, type ModuleCode, type Role } from "@routiq/contracts";

/**
 * Read access is independent of command capabilities; server scope still
 * applies. The role list is the server's own (`FINANCE_READER_ROLES`), so the
 * workshop never sees the books here either.
 */
export function canReadFinance(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    canReadLedger(role)
  );
}

const FINANCE_WRITERS: readonly Role[] = [
  "ADMIN",
  "OPS_MANAGER",
  "FINANCE_APPROVER",
  "FIELD_SUBMITTER",
];

export function canRecordFinance(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    FINANCE_WRITERS.includes(role)
  );
}

const ENTRY_REVERSERS: readonly Role[] = ["FINANCE_APPROVER", "ADMIN"];

/** Reverse is only offered on a POSTED entry, to approver roles (maker guard lives server-side). */
export function canReverseEntry(
  role: Role | undefined,
  entryStatus: string | undefined,
): boolean {
  return entryStatus === "POSTED" && role !== undefined && ENTRY_REVERSERS.includes(role);
}

const ENTRY_APPROVERS: readonly Role[] = ["FINANCE_APPROVER", "ADMIN"];

export function canApproveEntries(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    ENTRY_APPROVERS.includes(role)
  );
}

export function canManagePeriods(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canApproveEntries(role, enabledModules);
}

/**
 * Attaching a receipt later is open to whoever could have attached it at
 * capture: record-expense's roles, the workshop included (its work-order costs).
 */
const EVIDENCE_ATTACHERS: readonly Role[] = [
  "ADMIN",
  "OPS_MANAGER",
  "FINANCE_APPROVER",
  "FIELD_SUBMITTER",
  "MAINTENANCE",
];

export function canAttachEvidence(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    EVIDENCE_ATTACHERS.includes(role)
  );
}

/**
 * A cost booked against an approved work order. The workshop records expenses
 * only this way (the handler refuses its expenses without a work order), so
 * this is record-expense's list plus MAINTENANCE.
 */
export function canAddWorkOrderCost(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canRecordFinance(role, enabledModules) || (
    (enabledModules?.includes("FINANCE") ?? false) && role === "MAINTENANCE"
  );
}

/**
 * "Modifier" on a pending entry (#85): its author only, whatever their role,
 * and only while it waits. Everyone else rejects it instead. The roles are the
 * ones that record entries at all, the workshop included; the server checks
 * authorship and status again on every save.
 */
export function canEditPendingEntry(
  entry: { status: string; recordedBy: { principalId: string | null } } | undefined,
  viewer: {
    principalId: string | undefined;
    role: Role | undefined;
    enabledModules: readonly ModuleCode[] | undefined;
  },
): boolean {
  return (
    entry !== undefined &&
    entry.status === "SUBMITTED" &&
    entry.recordedBy.principalId !== null &&
    entry.recordedBy.principalId === viewer.principalId &&
    canAttachEvidence(viewer.role, viewer.enabledModules)
  );
}
