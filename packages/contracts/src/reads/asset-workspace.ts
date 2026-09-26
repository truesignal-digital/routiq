import { z } from "zod";
import { PROFITABILITY_LAYERS } from "../commands/categories.js";
import { COMMAND_ORIGINS, moneyMinor } from "../envelope.js";
import { ROLES } from "../roles.js";
import { meterReadingSource, meterReadingType } from "./assets.js";
import { monthCode } from "./finance.js";
import { historyActor, historyEntityType } from "./history.js";
import { listQuery, listResponse } from "./list.js";

/**
 * Reads behind the vehicle workspace (#44). Every one of them is scoped through
 * the vehicle: an asset outside the caller's workspace or branches answers 404
 * REFERENCE_NOT_FOUND, and a disabled owning module answers 403 MODULE_DISABLED.
 */

/** Newest first, fixed server-side; the cursor carries that order. */
export const assetReadingsQuery = listQuery({
  readingType: meterReadingType.optional(),
});

/**
 * One observation. Superseded rows are listed and flagged, not hidden: a
 * correction is part of the meter's story, and the client computes deltas over
 * the current ones.
 */
export const assetReadingItem = z.object({
  id: z.uuid(),
  readingType: meterReadingType,
  value: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
  source: meterReadingSource,
  activityId: z.uuid().nullable(),
  activityNumber: z.string().nullable(),
  supersededById: z.uuid().nullable(),
  /** Why this reading was corrected; set on the superseded row. */
  supersedeReason: z.string().nullable(),
  recordedBy: historyActor,
  origin: z.enum(COMMAND_ORIGINS),
});

export const assetReadingsResponse = listResponse(assetReadingItem);

/**
 * A member who may hold the vehicle: an active membership whose branch scope
 * covers the vehicle's branch — the same rule `assign-asset` enforces with
 * CUSTODIAN_INELIGIBLE. People without a login are not members and never appear.
 */
export const custodianCandidate = z.object({
  membershipId: z.uuid(),
  displayName: z.string(),
  role: z.enum(ROLES),
});

export const custodianCandidatesResponse = z.object({
  items: z.array(custodianCandidate),
});

export type AssetReadingsQuery = z.infer<typeof assetReadingsQuery>;
export type AssetReadingItem = z.infer<typeof assetReadingItem>;
export type AssetReadingsResponse = z.infer<typeof assetReadingsResponse>;
export type CustodianCandidate = z.infer<typeof custodianCandidate>;
export type CustodianCandidatesResponse = z.infer<typeof custodianCandidatesResponse>;

/**
 * A vehicle's money for one month. Every figure names its basis: posted money
 * by POSTING period (what the books say for the month), pending and rejected
 * by ECONOMIC month (when it was spent). Amounts are this vehicle's SIGNED
 * posting lines only — a split entry contributes its share, a reversal
 * subtracts — in the workspace currency; XAF has exponent 0. Entries are read
 * against the caller's branches by the ENTRY's branch, not the vehicle's.
 * Served only to the roles in FINANCE_READER_ROLES.
 */
export const assetFinanceQuery = z.object({
  /** Defaults to the current month in the workspace timezone. */
  periodCode: monthCode.optional(),
});

export const assetFinancePeriodStatuses = ["OPEN", "LOCKED", "NOT_STARTED"] as const;

export const assetFinanceResponse = z.object({
  assetId: z.uuid(),
  currency: z.string().length(3),
  periodCode: z.string(),
  /** NOT_STARTED: no posting period row exists for the month yet. */
  periodStatus: z.enum(assetFinancePeriodStatuses),
  /** Always all four, in order, so a client renders layers without guessing. */
  layers: z.array(z.enum(PROFITABILITY_LAYERS)),
  posted: z.object({
    basis: z.literal("POSTING_PERIOD"),
    expenseMinor: moneyMinor,
    revenueMinor: moneyMinor,
    entryCount: z.number().int().nonnegative(),
  }),
  pending: z.object({
    basis: z.literal("ECONOMIC_MONTH"),
    expenseMinor: moneyMinor,
    entryCount: z.number().int().nonnegative(),
  }),
  rejected: z.object({
    basis: z.literal("ECONOMIC_MONTH"),
    entryCount: z.number().int().nonnegative(),
  }),
  /** Entries still waiting for paperwork (NOT_SUPPLIED, reversals excluded). */
  evidenceMissing: z.object({
    postedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
  }),
  /** Posted expense by category, signed, largest first; categories netting to zero are left out. */
  byCategory: z.array(
    z.object({
      code: z.string(),
      labelFr: z.string(),
      labelEn: z.string(),
      layer: z.enum(PROFITABILITY_LAYERS),
      expenseMinor: moneyMinor,
    }),
  ),
  /** Six posting periods ending at `periodCode`, oldest first, zero-filled. */
  series: z.array(
    z.object({
      periodCode: z.string(),
      expenseMinor: moneyMinor,
      revenueMinor: moneyMinor,
    }),
  ),
});

/**
 * What needs someone on this vehicle, as facts. The server derives them —
 * business date, branch scope and module gates live here — and names the
 * principals who may NOT take the next step (maker/checker, self-release);
 * which step is the caller's own stays the client's decision.
 */
export const ATTENTION_CODES = [
  "ISSUE_UNPLANNED",
  /**
   * A safety-critical signalement still OPEN on a vehicle that is not grounded:
   * its work order was completed and the vehicle released, but nobody closed
   * the signalement (release warned GROUNDING_ISSUE_STILL_OPEN). INFO — the
   * release was a deliberate decision; what is left is resolving or dismissing.
   */
  "ISSUE_OPEN_WHILE_AVAILABLE",
  "WORK_ORDER_AWAITING_AUTHORIZATION",
  "WORK_ORDER_IN_PROGRESS",
  "WORK_ORDER_AWAITING_SIGN_OFF",
  "ASSET_AWAITING_RELEASE",
  "DOCUMENT_EXPIRED",
  "DOCUMENT_EXPIRING",
  "ENTRY_AWAITING_REVIEW",
  "ENTRY_EVIDENCE_MISSING",
] as const;
export const attentionCode = z.enum(ATTENTION_CODES);

export const ATTENTION_SEVERITIES = ["CRITICAL", "WARNING", "INFO"] as const;
export const attentionSeverity = z.enum(ATTENTION_SEVERITIES);

export const ATTENTION_SUBJECT_TYPES = [
  "operational_issue",
  "work_order",
  "asset_availability_interval",
  "document",
  "financial_entry",
] as const;

/** How many days ahead an expiry becomes DOCUMENT_EXPIRING. */
export const DOCUMENT_EXPIRING_WINDOW_DAYS = 30;

/** At most this many items, most severe and oldest first. */
export const ATTENTION_ITEM_LIMIT = 50;

export const assetAttentionItem = z.object({
  code: attentionCode,
  severity: attentionSeverity,
  subject: z.object({
    entityType: z.enum(ATTENTION_SUBJECT_TYPES),
    id: z.uuid(),
    /** Entry or document number; null where the record has none. */
    number: z.string().nullable(),
    /** The version a command on the subject quotes; null for documents (never edited). */
    rowVersion: z.number().int().positive().nullable(),
  }),
  /**
   * Since when this needs attention. Documents have a date, not an instant:
   * theirs is UTC midnight of the expiry (EXPIRED) or of the day it entered the
   * 30-day window (EXPIRING); display from `params.expiresAt`.
   */
  since: z.iso.datetime(),
  /** The subject is the grounding signalement, one of its work orders, or the open interval. */
  partOfGrounding: z.boolean(),
  /** Principals who may not take the next step on this item; empty when anyone eligible may. */
  makerPrincipalIds: z.array(z.uuid()),
  /** Allowlisted facts for the sentence; every key optional. */
  params: z
    .object({
      description: z.string().max(140),
      safetyCritical: z.boolean(),
      amountMinor: moneyMinor,
      currency: z.string().length(3),
      expectedCostMinor: moneyMinor,
      actualCostMinor: moneyMinor,
      documentTypeLabelFr: z.string(),
      documentTypeLabelEn: z.string(),
      expiresAt: z.iso.date(),
      /** Days from the business date to expiry; negative once expired. */
      daysLeft: z.number().int(),
      recordedBy: historyActor,
      /** No completed work order answers the grounding; release needs an override reason. */
      overrideRequired: z.boolean(),
      completionRejectReason: z.string(),
      hasCompletedWorkOrder: z.boolean(),
      categoryLabelFr: z.string(),
      categoryLabelEn: z.string(),
    })
    .partial(),
});

export const assetAttentionResponse = z.object({
  assetId: z.uuid(),
  /** Today in the workspace timezone — what document expiry was judged against. */
  businessDate: z.iso.date(),
  items: z.array(assetAttentionItem),
});

export type AssetFinanceQuery = z.infer<typeof assetFinanceQuery>;
export type AssetFinanceResponse = z.infer<typeof assetFinanceResponse>;
export type AttentionCode = z.infer<typeof attentionCode>;
export type AttentionSeverity = z.infer<typeof attentionSeverity>;
export type AssetAttentionItem = z.infer<typeof assetAttentionItem>;
export type AssetAttentionResponse = z.infer<typeof assetAttentionResponse>;

/**
 * The vehicle's timeline: one query over the audit trail of every record that
 * belongs to it — the vehicle itself, its trips, readings, documents, money,
 * maintenance and notes. A read of the trail, never a ledger of its own.
 */
export const VEHICLE_HISTORY_KINDS = [
  "MAINTENANCE",
  "MONEY",
  "TRIPS",
  "DOCUMENTS",
  "READINGS",
  "ASSIGNMENTS",
  "LIFECYCLE",
  "NOTES",
] as const;
export const vehicleHistoryKind = z.enum(VEHICLE_HISTORY_KINDS);

/** Newest first, fixed server-side. `kind` repeats for several kinds. */
export const vehicleHistoryQuery = listQuery({
  kind: z
    .union([vehicleHistoryKind, z.array(vehicleHistoryKind).min(1)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
});

/**
 * The facts an item may carry, per subject — an allowlist, never a
 * passthrough of the audit snapshots. `asset.assigned` resolves the ids it
 * moved into names through same-workspace joins.
 */
export const VEHICLE_HISTORY_PARAMS = {
  activity: ["activityNumber", "customerName"],
  movement_leg: ["originName", "destinationName", "distanceKm"],
  meter_reading: ["readingType", "value", "source"],
  document: ["documentTypeLabelFr", "documentTypeLabelEn", "documentNumber", "expiresAt"],
  financial_entry: [
    "entryNumber",
    "direction",
    "categoryLabelFr",
    "categoryLabelEn",
    "status",
    "artifactCount",
  ],
  operational_issue: ["description", "safetyCritical"],
  work_order: ["description"],
  asset_availability_interval: ["issueDescription"],
  "asset.assigned": [
    "custodianDisplayName",
    "previousCustodianDisplayName",
    "branchCode",
    "previousBranchCode",
  ],
  note: ["body"],
} as const;

export const vehicleHistoryItem = z.object({
  eventId: z.uuid(),
  /** Open vocabulary, as on the record history; unknown codes render raw. */
  eventType: z.string(),
  kind: vehicleHistoryKind,
  occurredAt: z.iso.datetime(),
  actor: historyActor,
  origin: z.enum(COMMAND_ORIGINS),
  subject: z.object({
    entityType: historyEntityType,
    id: z.uuid(),
    /** Entry, activity or document number; null where the record has none. */
    number: z.string().nullable(),
  }),
  /** MONEY only: this vehicle's SIGNED share of the entry — a reversal is negative. */
  amountMinor: z.number().int().nullable(),
  currency: z.string().length(3).nullable(),
  /** Keys from VEHICLE_HISTORY_PARAMS for the subject; `status` is the entry's current one. */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** The event's own reason, as the record history lifts it. */
  note: z.string().nullable(),
});

export const vehicleHistoryResponse = listResponse(vehicleHistoryItem);

export type VehicleHistoryKind = z.infer<typeof vehicleHistoryKind>;
export type VehicleHistoryQuery = z.infer<typeof vehicleHistoryQuery>;
export type VehicleHistoryItem = z.infer<typeof vehicleHistoryItem>;
export type VehicleHistoryResponse = z.infer<typeof vehicleHistoryResponse>;
