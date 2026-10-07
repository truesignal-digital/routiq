import { z } from "zod";
import { PROFITABILITY_LAYERS } from "../commands/categories.js";
import { historyActor } from "./history.js";
import { listResponse } from "./list.js";

const categoryType = z.object({
  code: z.string(),
  labelFr: z.string(),
  labelEn: z.string(),
});

/** An entry's category, with the profitability layer it rolls up into (§4.2). */
const entryCategory = categoryType.extend({
  layer: z.enum(PROFITABILITY_LAYERS).nullable(),
});

/**
 * An entry's paperwork in four honest states — none of them "verified" (see
 * `entryEvidenceState` in @routiq/domain for the rule and its precedence).
 */
export const ENTRY_EVIDENCE_STATES = [
  "SUPPLIED",
  "PAYMENT_REFERENCE",
  "NOT_EXPECTED",
  "NOT_SUPPLIED",
] as const;
export const entryEvidenceState = z.enum(ENTRY_EVIDENCE_STATES);

/**
 * `artifactCount` counts distinct files linked to the entry: those of the
 * command that recorded it plus every `attach-evidence`. A reversal row is
 * computed like any other; it never needs paperwork of its own, so clients
 * ignore it where `reversesEntryId` is set, and `evidence=MISSING` skips it.
 * Known imprecision: a file attached to a composite sheet counts for every
 * entry that sheet created.
 */
export const entryEvidence = z.object({
  state: entryEvidenceState,
  artifactCount: z.number().int().nonnegative(),
});

/** `YYYY-MM`, a calendar month. */
export const monthCode = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Both the original and negative reversal contribute to signed ledger totals. */
export const ledgerEntryStatuses = ["POSTED", "REVERSED"] as const;

/** LEDGER is a read-filter bucket, never a stored entry status. */
export const financialEntryFilters = z.object({
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED", "LEDGER"]).optional(),
  direction: z.enum(["EXPENSE", "REVENUE"]).optional(),
  periodCode: z.string().optional(),
  /** Month of the ECONOMIC date — the basis for pending and rejected money. */
  economicMonth: monthCode.optional(),
  /** Entries still waiting for paperwork: NOT_SUPPLIED, reversals excluded. */
  evidence: z.enum(["MISSING"]).optional(),
  assetId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  /**
   * `events` (default): one line per real event (#427). A cancellation whose
   * original falls in the same filtered window is left out and named on the
   * original instead. `books`: every signed row, originals and cancellations.
   */
  view: z.enum(["events", "books"]).optional(),
});

/** The cancellation of an original entry, as its line in a money list names it (#427). */
export const entryCancellation = z.object({
  entryId: z.uuid(),
  entryNumber: z.string(),
  postingPeriodCode: z.string().nullable(),
  postedAt: z.iso.datetime().nullable(),
  /** Null for a cancellation recorded before reasons were picked from a list. */
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  recordedBy: historyActor,
  /**
   * The cancellation is not a line of this list: it falls in the same window
   * as the original, which then counts 0 there. False in the books view and
   * when the cancellation posted in a later month than the list shows.
   */
  folded: z.boolean(),
});

/** On a cancellation's own line: the original it cancels, and that original's month. */
export const cancelledEntryRef = z.object({
  entryId: z.uuid(),
  entryNumber: z.string(),
  postingPeriodCode: z.string().nullable(),
});

export const financialEntryListItem = z.object({
  id: z.uuid(),
  entryNumber: z.string(),
  direction: z.enum(["REVENUE", "EXPENSE"]),
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]),
  category: entryCategory,
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
  /** Set on a reversal row: the entry it cancels. */
  reversesEntryId: z.uuid().nullable(),
  /** On an original: its posted cancellation, when the reader may read it (#427). */
  cancelledBy: entryCancellation.nullable(),
  /** On a cancellation's line: the original, when the reader may read it. */
  cancels: cancelledEntryRef.nullable(),
  /** Who recorded the entry, masked for PLATFORM actors like the history read. */
  recordedBy: historyActor,
  evidence: entryEvidence,
  /**
   * With an `assetId` filter: the SIGNED sum of this entry's lines on that
   * vehicle — a split entry contributes only its share. Null without the filter.
   */
  assetShareMinor: z.number().int().nullable(),
  /**
   * With an `assetId` filter: what the vehicle's lines are attributed to, from
   * its first line carrying each dimension. Null without the filter.
   */
  assetLinks: z
    .object({
      activityId: z.uuid().nullable(),
      activityNumber: z.string().nullable(),
      workOrderId: z.uuid().nullable(),
    })
    .nullable(),
  /**
   * The trip and the work order the entry belongs to, from its first line
   * carrying each, on any vehicle (#87). Set with or without a filter. The
   * work order opens in its vehicle's workspace, so its asset comes along.
   */
  links: z.object({
    activityId: z.uuid().nullable(),
    activityNumber: z.string().nullable(),
    workOrderId: z.uuid().nullable(),
    workOrderAssetId: z.uuid().nullable(),
  }),
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
  /** The trip and work order the line is attributed to, so an edit keeps them. */
  activityId: z.uuid().nullable(),
  workOrderId: z.uuid().nullable(),
  category: categoryType,
});

/**
 * One file behind an entry. `via` says how it got there: with the command that
 * recorded the entry, or through a later `attach-evidence`. Downloads go
 * through the entry-scoped route, never the workspace-wide one.
 */
export const entryEvidenceFile = z.object({
  artifactId: z.uuid(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  originalFileName: z.string().nullable(),
  sha256: z.string(),
  attachedAt: z.iso.datetime(),
  attachedBy: historyActor,
  via: z.enum(["RECORDED", "ATTACHED"]),
});

/** The one-line-per-event fields belong to money lists, not to a single entry. */
const entryRecord = financialEntryListItem.omit({ cancelledBy: true, cancels: true });

export const financialEntryDetail = entryRecord.extend({
  description: z.string().nullable(),
  paymentReference: z.string().nullable(),
  sourceReference: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  reversedByEntryId: z.uuid().nullable(),
  postings: z.array(financialPosting),
  /** The files counted by `evidence.artifactCount`, oldest first. */
  evidenceFiles: z.array(entryEvidenceFile),
  /**
   * For the viewer: the approval chain keeps their role from deciding this
   * pending entry, so Direction decides it (ADR-0009: Finance up to its band,
   * 1 000 000 XAF by default). False when the entry is not pending, when the viewer may
   * decide it, and for roles outside the entry chain.
   */
  directionDecides: z.boolean().default(false),
});

export type EntryEvidenceState = z.infer<typeof entryEvidenceState>;
export type EntryEvidence = z.infer<typeof entryEvidence>;
export type EntryEvidenceFile = z.infer<typeof entryEvidenceFile>;
export type EntryCancellation = z.infer<typeof entryCancellation>;
export type CancelledEntryRef = z.infer<typeof cancelledEntryRef>;
export type FinancialEntryListItem = z.infer<typeof financialEntryListItem>;
export type FinancialEntryListResponse = z.infer<typeof financialEntryListResponse>;
export type FinancialPosting = z.infer<typeof financialPosting>;
export type FinancialEntryDetail = z.infer<typeof financialEntryDetail>;

export const pendingApprovalItem = entryRecord.extend({
  submittedByPrincipalId: z.uuid(),
  submittedAt: z.iso.datetime(),
  /**
   * For the viewer: the approval chain keeps their role from deciding this
   * pending entry, so Direction decides it (ADR-0009: Finance up to its band,
   * 1 000 000 XAF by default). False when the entry is not pending, when the viewer may
   * decide it, and for roles outside the entry chain.
   */
  directionDecides: z.boolean().default(false),
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
