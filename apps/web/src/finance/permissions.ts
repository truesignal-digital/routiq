import {
  canBookWorkOrderCost,
  canReadEntries,
  canReadLedger,
  MONEY_OVERVIEW_READER_ROLES,
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

/**
 * The Money page's Overview tab: the server's own list (`GET
 * /v1/finance/overview`, `MONEY_OVERVIEW_READER_ROLES`). The cashier is in it
 * and reads revenue and expenses with no profit; a driver is not.
 */
export function canReadMoneyOverview(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    (MONEY_OVERVIEW_READER_ROLES as readonly Role[]).includes(role)
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

/** The entry facts that decide whether it can still be reversed. */
export interface ReversibleEntry {
  status: string;
  reversesEntryId: string | null;
}

/**
 * Reverse is offered to approver roles on a POSTED original only: never on an
 * entry already reversed, and never on a reversal itself (#130, one level
 * only). The server refuses both too; the maker guard lives server-side.
 */
export function canReverseEntry(
  role: Role | undefined,
  entry: ReversibleEntry | undefined,
): boolean {
  return (
    entry?.status === "POSTED" &&
    entry.reversesEntryId === null &&
    role !== undefined &&
    ENTRY_DECIDERS.includes(role)
  );
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
 * A cost booked against an approved work order: the server's own list
 * (`canBookWorkOrderCost`), with the books switched on.
 */
export function canAddWorkOrderCost(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  return (
    (enabledModules?.includes("FINANCE") ?? false) &&
    role !== undefined &&
    canBookWorkOrderCost(role)
  );
}

/**
 * Record again after a "wrong details" cancellation: the copy keeps the
 * original's lines, work order included, so a work-order cost goes back only
 * through the roles that book one (#559). Finance cancels it and hands it on.
 */
export function canRecordAgain(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
  entry: { links: { workOrderId: string | null } },
): boolean {
  return (
    canRecordFinance(role, enabledModules) &&
    (entry.links.workOrderId === null || canAddWorkOrderCost(role, enabledModules))
  );
}

/**
 * What Cancel entry offers after "wrong details": Record again when the viewer
 * may record the copy, the way to the work order when it is a work-order cost
 * someone else books, nothing otherwise. Spread onto `ReverseEntryForm`.
 */
export function recordAgainStep(
  viewer: { role: Role; enabledModules: readonly ModuleCode[] } | undefined,
  entry: { links: { workOrderId: string | null; workOrderAssetId: string | null } },
  handlers: { recordAgain: () => void; openWorkOrder: (assetId: string, workOrderId: string) => void },
): { onRecordAgain?: () => void; onOpenWorkOrder?: () => void } {
  if (canRecordAgain(viewer?.role, viewer?.enabledModules, entry)) return { onRecordAgain: handlers.recordAgain };
  const { workOrderId, workOrderAssetId } = entry.links;
  if (workOrderId === null || workOrderAssetId === null) return {};
  return { onOpenWorkOrder: () => handlers.openWorkOrder(workOrderAssetId, workOrderId) };
}

/**
 * "Modifier" on a pending entry (#85): its author only, whatever their role,
 * and only while it waits. Everyone else rejects it instead. The roles are the
 * ones that record entries at all, the workshop included; the server checks
 * authorship and status again on every save. A revenue entry only for a role
 * that records revenue: a driver records expenses only (#572).
 */
export function canEditPendingEntry(
  entry:
    | {
        status: string;
        direction: "EXPENSE" | "REVENUE";
        recordedBy: { principalId: string | null };
      }
    | undefined,
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
    canAttachEvidence(viewer.role, viewer.enabledModules) &&
    (entry.direction === "EXPENSE" || canRecordRevenue(viewer.role, viewer.enabledModules))
  );
}
