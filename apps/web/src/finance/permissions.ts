import {
  canReadEntries,
  canReadLedger,
  moneyReadScope,
  type ModuleCode,
  type MoneyReadScope,
  type Role,
} from "@routiq/contracts";

/**
 * The books: vehicle totals, period figures, the Money tab. Read access is
 * independent of command capabilities; the role list is the server's own
 * (`LEDGER_READER_ROLES`), so nobody is shown a figure the API withholds.
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

/**
 * The entries list and an entry's detail: the ledger readers, the counter
 * (its branches' entries) and the drivers (their own). The server filters the
 * rows; the workshop reads its costs on the work orders instead.
 */
export function canReadFinanceEntries(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    canReadEntries(role)
  );
}

/** Which slice of the entries the server returns to this role, to say so on screen. */
export function entriesScope(role: Role | undefined): MoneyReadScope | undefined {
  return role === undefined ? undefined : moneyReadScope(role);
}

/**
 * record-expense outside the workshop: every role that handles money or runs
 * trips. TECHNICIAN books costs only on work orders (`canAddWorkOrderCost`).
 */
const EXPENSE_RECORDERS: readonly Role[] = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "DRIVER"];

export function canRecordFinance(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    EXPENSE_RECORDERS.includes(role)
  );
}

const REVENUE_RECORDERS: readonly Role[] = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER"];

/** record-revenue: the money roles and the managers; drivers record expenses only. */
export function canRecordRevenue(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    REVENUE_RECORDERS.includes(role)
  );
}

/** Approving, rejecting and reversing entries, and locking a period: Direction and Finance. */
const ENTRY_DECIDERS: readonly Role[] = ["DIRECTOR", "FINANCE"];

/** Reverse is only offered on a POSTED entry, to approver roles (maker guard lives server-side). */
export function canReverseEntry(
  role: Role | undefined,
  entryStatus: string | undefined,
): boolean {
  return entryStatus === "POSTED" && role !== undefined && ENTRY_DECIDERS.includes(role);
}

export function canApproveEntries(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    ENTRY_DECIDERS.includes(role)
  );
}

/** Locking a period, and seeing the periods screen at all. */
export function canManagePeriods(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canApproveEntries(role, enabledModules);
}

/** Reopening a locked period undoes the books' boundary: Direction only. */
export function canReopenPeriod(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (enabledModules?.includes("FINANCE") ?? false) && role === "DIRECTOR";
}

/**
 * Attaching a receipt later is open to whoever could have attached it at
 * capture: every role, the workshop included (its work-order costs). The
 * server limits TECHNICIAN and DRIVER to their own entries.
 */
export function canAttachEvidence(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (enabledModules?.includes("FINANCE") ?? false) && role !== undefined;
}

/**
 * A cost booked against an approved work order. The workshop records expenses
 * only this way (the handler refuses its expenses without a work order), so
 * this is record-expense's list plus TECHNICIAN.
 */
export function canAddWorkOrderCost(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return canRecordFinance(role, enabledModules) || (
    (enabledModules?.includes("FINANCE") ?? false) && role === "TECHNICIAN"
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
