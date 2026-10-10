import { z } from "zod";
import { CANCELLATION_REASON_CODES } from "@routiq/contracts";
// Money parsing is shared with every form that takes an amount, so it lives in lib.
export { parseMoneyXaf } from "../lib/format.js";
import type {
  recordExpensePayload,
  recordRevenuePayload,
  updatePendingEntryPayload,
  PeriodRead,
  CancellationReasonCode,
  ReverseEntryPayload,
} from "@routiq/contracts";

type RecordExpensePayload = z.infer<typeof recordExpensePayload>;
type RecordRevenuePayload = z.infer<typeof recordRevenuePayload>;
type UpdatePendingEntryPayload = z.infer<typeof updatePendingEntryPayload>;


/** A record's direction in words, where its own amount is shown unsigned. */
export function amountKind(entry: {
  direction: "REVENUE" | "EXPENSE";
  reversesEntryId: string | null;
}): string {
  return entry.reversesEntryId === null ? entry.direction : `${entry.direction}_REVERSAL`;
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

/**
 * The reason part of a reverse-entry.v2 payload, or undefined while the form
 * can't send one: no reason picked yet, or Other without words (1-500).
 */
export function cancellationPayload(
  reasonCode: CancellationReasonCode | undefined,
  reasonText: string,
): Pick<ReverseEntryPayload, "reasonCode" | "reasonText"> | undefined {
  if (reasonCode === undefined) return undefined;
  if (reasonCode !== "OTHER") return { reasonCode };
  const trimmed = reasonText.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return undefined;
  return { reasonCode, reasonText: trimmed };
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
 * Merge an implicit OPEN period for the current month if not present.
 * Allows locking the current month even if no entries have been posted yet.
 * `current` is the server's month in the workspace's time zone (#591); the
 * device clock may be in another month or zone.
 */
export function mergeImplicitCurrentPeriod(
  periods: PeriodRead[],
  current: string,
): PeriodRead[] {
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

/**
 * A cancellation's reason in words (#426): the listed reason, or for Other the
 * person's own words. A code this build doesn't know shows as Other.
 */
export function cancellationReasonWords(
  cancellation: { reasonCode: string; reasonText: string | null },
  t: (key: string) => string,
): string {
  if (cancellation.reasonCode === "OTHER" || !isCancellationReasonCode(cancellation.reasonCode)) {
    return cancellation.reasonText ?? t("reasonCodes.OTHER");
  }
  return t(`reasonCodes.${cancellation.reasonCode}`);
}

function isCancellationReasonCode(code: string): code is CancellationReasonCode {
  return (CANCELLATION_REASON_CODES as readonly string[]).includes(code);
}
