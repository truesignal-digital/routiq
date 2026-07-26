import { z } from "zod";
import type {
  recordExpensePayload,
  recordRevenuePayload,
} from "@routiq/contracts";

type RecordExpensePayload = z.infer<typeof recordExpensePayload>;
type RecordRevenuePayload = z.infer<typeof recordRevenuePayload>;

/**
 * Format XAF minor units to a display string with thousands grouping.
 * XAF has exponent 0 — 1 XAF = 1 minor unit; never divide by 100.
 */
export function formatMoneyXaf(minor: number): string {
  const formatted = new Intl.NumberFormat("fr-CM", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minor);
  // Normalize non-breaking space (U+202F) and other whitespace to regular space
  return formatted.replace(/[  ]/g, " ");
}

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
    postings: [
      {
        assetId: form.assetId,
        amountMinor: form.amountMinor,
        assetAttribution: "DIRECT",
      },
    ],
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
    postings: [
      {
        assetId: form.assetId,
        amountMinor: form.amountMinor,
        assetAttribution: "DIRECT",
      },
    ],
  };
}
