import { z } from "zod";
import { listResponse } from "./list.js";

const categoryType = z.object({
  code: z.string(),
  labelFr: z.string(),
  labelEn: z.string(),
});

/** Both the original and negative reversal contribute to signed ledger totals. */
export const ledgerEntryStatuses = ["POSTED", "REVERSED"] as const;

/** LEDGER is a read-filter bucket, never a stored entry status. */
export const financialEntryFilters = z.object({
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED", "LEDGER"]).optional(),
  direction: z.enum(["EXPENSE", "REVENUE"]).optional(),
  periodCode: z.string().optional(),
  assetId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});

export const financialEntryListItem = z.object({
  id: z.uuid(),
  entryNumber: z.string(),
  direction: z.enum(["REVENUE", "EXPENSE"]),
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]),
  category: categoryType,
  amountMinor: z.number(),
  currency: z.string(),
  economicDate: z.iso.date(),
  postingPeriodCode: z.string().nullable(),
  isLatePosting: z.boolean(),
  branchId: z.uuid(),
  counterpartyName: z.string().nullable(),
  paymentMethod: z.enum(["CASH", "MOMO", "OM", "BANK", "OTHER"]),
  estimateStatus: z.enum(["ACTUAL", "ESTIMATED"]),
  postedAt: z.iso.datetime().nullable(),
  rowVersion: z.number(),
});

/** `entries`, not `items`: the published key on /v1/finance/entries (ADR-0003). */
export const financialEntryListResponse = listResponse(financialEntryListItem, {
  key: "entries",
});

const financialPosting = z.object({
  lineNo: z.number(),
  amountMinor: z.number(),
  assetId: z.uuid().nullable(),
  assetCode: z.string().nullable(),
  assetAttribution: z.enum(["DIRECT", "ALLOCATED"]),
  category: categoryType,
});

export const financialEntryDetail = financialEntryListItem.extend({
  description: z.string().nullable(),
  paymentReference: z.string().nullable(),
  sourceReference: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  reversesEntryId: z.uuid().nullable(),
  reversedByEntryId: z.uuid().nullable(),
  postings: z.array(financialPosting),
});

export type FinancialEntryListItem = z.infer<typeof financialEntryListItem>;
export type FinancialEntryListResponse = z.infer<typeof financialEntryListResponse>;
export type FinancialPosting = z.infer<typeof financialPosting>;
export type FinancialEntryDetail = z.infer<typeof financialEntryDetail>;

export const pendingApprovalItem = financialEntryListItem.extend({
  submittedByPrincipalId: z.uuid(),
  submittedAt: z.iso.datetime(),
});

/**
 * Keyset-paginated like every list read, but it also publishes `total`: the
 * dashboard card and the queue badge count the whole queue, not the page. The
 * `entries` key is inherited from before ADR-0003, same as the entries list.
 */
export const pendingApprovalsResponse = listResponse(pendingApprovalItem, {
  key: "entries",
}).extend({
  total: z.number(),
  /**
   * Pending entries the `branchId` filter excludes, inside the caller's branch
   * scope — zero when the queue already spans every branch. A decision queue
   * may narrow, but never silently: this is what the narrowing is hiding.
   */
  outsideBranchCount: z.number().int().nonnegative().default(0),
});

export const periodRead = z.object({
  periodCode: z.string(),
  status: z.enum(["OPEN", "LOCKED"]),
  lockedAt: z.iso.datetime().nullable(),
  entryCount: z.number(),
  rowVersion: z.number(),
});

export const periodsResponse = z.object({
  periods: z.array(periodRead),
});

export type PendingApprovalItem = z.infer<typeof pendingApprovalItem>;
export type PendingApprovalsResponse = z.infer<typeof pendingApprovalsResponse>;
export type PeriodRead = z.infer<typeof periodRead>;
export type PeriodsResponse = z.infer<typeof periodsResponse>;
