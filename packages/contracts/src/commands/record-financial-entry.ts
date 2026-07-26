import { z } from "zod";
import { commandEnvelope, currencyCode, moneyMinor } from "../envelope.js";

const positiveMoneyMinor = moneyMinor.positive().max(Number.MAX_SAFE_INTEGER);

export const financialEntryPostingPayload = z.object({
  assetId: z.uuid().optional(),
  amountMinor: positiveMoneyMinor,
  assetAttribution: z.enum(["DIRECT", "ALLOCATED"]).default("DIRECT"),
});

/**
 * Shared shape for record-revenue.v1 / record-expense.v1 (§4.2). Client amounts
 * are always positive; the server signs reversal rows. Postings must sum to the
 * entry amount — enforced in the command layer, not here.
 */
export const financialEntryPayload = z.object({
  entryId: z.uuid(),
  branchCode: z.string().min(1).max(40),
  categoryCode: z.string().min(1).max(80),
  economicDate: z.iso.date(),
  counterpartyName: z.string().min(1).max(160).optional(),
  description: z.string().min(1).max(500).optional(),
  amountMinor: positiveMoneyMinor,
  currency: currencyCode.default("XAF"),
  paymentMethod: z.enum(["CASH", "MOMO", "OM", "BANK", "OTHER"]),
  paymentReference: z.string().min(1).max(160).optional(),
  sourceReference: z.string().min(1).max(160).optional(),
  estimateStatus: z.enum(["ACTUAL", "ESTIMATED"]).default("ACTUAL"),
  postings: z.array(financialEntryPostingPayload).min(1),
});

export const recordExpensePayload = financialEntryPayload;
export const recordRevenuePayload = financialEntryPayload;

export const recordExpenseCommand = z.object({
  name: z.literal("record-expense"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: recordExpensePayload,
});

export const recordRevenueCommand = z.object({
  name: z.literal("record-revenue"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: recordRevenuePayload,
});

export type RecordExpenseCommand = z.infer<typeof recordExpenseCommand>;
export type RecordRevenueCommand = z.infer<typeof recordRevenueCommand>;
