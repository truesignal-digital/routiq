import { z } from "zod";

const categoryType = z.object({
  code: z.string(),
  labelFr: z.string(),
  labelEn: z.string(),
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

export const financialEntryListResponse = z.object({
  entries: z.array(financialEntryListItem),
  nextCursor: z.string().nullable(),
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

export const pendingApprovalsResponse = z.object({
  entries: z.array(pendingApprovalItem),
  total: z.number(),
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
