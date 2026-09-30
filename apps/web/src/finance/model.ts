import { z } from "zod";
import type {
  recordExpensePayload,
  recordRevenuePayload,
  updatePendingEntryPayload,
  PeriodRead,
} from "@routiq/contracts";

type RecordExpensePayload = z.infer<typeof recordExpensePayload>;
type RecordRevenuePayload = z.infer<typeof recordRevenuePayload>;
type UpdatePendingEntryPayload = z.infer<typeof updatePendingEntryPayload>;

/**
 * Parse user input string to XAF minor units (positive integer).
 * Removes whitespace and thousands separators; returns null if invalid.
 */
export function parseMoneyXaf(input: string): number | null {
  if (!input.trim()) return null;
  // Reject if input contains decimal point or comma (which would be decimal in some locales)
  if (input.includes(".") || input.includes(",")) return null;
  // Remove whitespace and common separators
  const normalized = input.replace(/[\s]/g, "");
  const parsed = parseInt(normalized, 10);
  if (isNaN(parsed) || parsed < 0) return null;
  return parsed;
}

export interface FinanceFormState {
  entryId: string;
  branchCode: string;
  economicDate: string;
  categoryCode: string;
  amountMinor: number;
  paymentMethod: "CASH" | "MOMO" | "OM" | "BANK" | "OTHER";
  counterpartyName?: string;
  description?: string;
  paymentReference?: string;
  assetId?: string;
  /** The trip the amount was spent on: a dimension on the line, never a second entry. */
  activityId?: string;
  /** The repair the amount pays for, counted once on the work order and the vehicle. */
  workOrderId?: string;
}

/** The entry's single line: its whole amount, on the dimensions the form named. */
function singlePosting(form: FinanceFormState) {
  return {
    assetId: form.assetId,
    amountMinor: form.amountMinor,
    assetAttribution: "DIRECT" as const,
    ...(form.activityId === undefined ? {} : { activityId: form.activityId }),
    ...(form.workOrderId === undefined ? {} : { workOrderId: form.workOrderId }),
  };
}

/**
 * Map form state to record-expense.v1 or record-revenue.v1 payload.
 * Single posting equal to entry amount, optional assetId with DIRECT attribution.
 */
export function toRecordExpensePayload(
  form: FinanceFormState,
): RecordExpensePayload {
  return {
    entryId: form.entryId,
    branchCode: form.branchCode,
    economicDate: form.economicDate,
    categoryCode: form.categoryCode,
    amountMinor: form.amountMinor,
    currency: "XAF",
    paymentMethod: form.paymentMethod,
    paymentReference: form.paymentReference,
    counterpartyName: form.counterpartyName,
    description: form.description,
    estimateStatus: "ACTUAL",
    postings: [singlePosting(form)],
  };
}

export function toRecordRevenuePayload(
  form: FinanceFormState,
): RecordRevenuePayload {
  return {
    entryId: form.entryId,
    branchCode: form.branchCode,
    economicDate: form.economicDate,
    categoryCode: form.categoryCode,
    amountMinor: form.amountMinor,
    currency: "XAF",
    paymentMethod: form.paymentMethod,
    paymentReference: form.paymentReference,
    counterpartyName: form.counterpartyName,
    description: form.description,
    estimateStatus: "ACTUAL",
    postings: [singlePosting(form)],
  };
}

/**
 * The author's edit of a pending entry: the recording payload without the
 * branch, which stays where the entry was recorded. A field left empty is sent
 * absent, which clears it.
 */
export function toUpdatePendingEntryPayload(
  form: FinanceFormState,
): UpdatePendingEntryPayload {
  return {
    entryId: form.entryId,
    economicDate: form.economicDate,
    categoryCode: form.categoryCode,
    amountMinor: form.amountMinor,
    currency: "XAF",
    paymentMethod: form.paymentMethod,
    paymentReference: form.paymentReference,
    counterpartyName: form.counterpartyName,
    description: form.description,
    estimateStatus: "ACTUAL",
    postings: [singlePosting(form)],
  };
}

/** Mirrors reverse-entry.v1 contract: reason z.string().min(1).max(500). */
export function validateReversalReason(reason: string): boolean {
  return reason.trim().length > 0 && reason.length <= 500;
}

/**
 * Validate rejection reason (required, 1-500 chars).
 * Mirrors the contract bound in packages/contracts/src/commands/approve-entry.ts
 */
export function validateRejectionReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length <= 500;
}

/**
 * Check if a principal made a submission (maker guard).
 * Returns true if the entry was submitted by the current session principal.
 */
export function isOwnSubmission(
  submittedByPrincipalId: string,
  sessionPrincipalId: string | undefined,
): boolean {
  return sessionPrincipalId !== undefined && submittedByPrincipalId === sessionPrincipalId;
}

/**
 * Compute the current period code (YYYY-MM format) from today's date.
 */
export function currentPeriodCode(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Merge an implicit OPEN period for the current month if not present.
 * Allows locking the current month even if no entries have been posted yet.
 */
export function mergeImplicitCurrentPeriod(
  periods: PeriodRead[],
): PeriodRead[] {
  const current = currentPeriodCode();
  const hasCurrentPeriod = periods.some((p) => p.periodCode === current);

  if (hasCurrentPeriod) {
    return periods;
  }

  return [
    {
      periodCode: current,
      status: "OPEN" as const,
      lockedAt: null,
      entryCount: 0,
      rowVersion: 0,
    },
    ...periods,
  ];
}

/**
 * Validate reopen reason (required, 1-500 chars after trim).
 * Mirrors the contract bound in packages/contracts/src/commands/lock-period.ts
 */
export function validateReopenReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length <= 500;
}
