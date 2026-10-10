import { z } from "zod";
import { workOrderCostOutcome } from "../commands/complete-work-order.js";
import { recordArtifact } from "./artifacts.js";
import { historyActor } from "./history.js";
import { listQuery, listResponse } from "./list.js";

/**
 * The owner's state machine (#28). APPROVED is open work, where costs attach;
 * a COMPLETED order still takes the invoice that arrives after the close, and
 * that one always waits for review (#82). The two pending states exist only
 * when a threshold rule demanded review; COMPLETED, REJECTED and CANCELLED are
 * terminal and never reopen.
 */
export const workOrderStatuses = [
  "SUBMITTED",
  "APPROVED",
  "COMPLETION_SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;
export const workOrderStatus = z.enum(workOrderStatuses);

/** OPEN until resolved (dealt with) or dismissed (reported in error). No triage state. */
export const issueStatuses = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export const issueStatus = z.enum(issueStatuses);

/**
 * A work order's or problem's number (#608): a per-workspace sequence the
 * server draws when the creating command commits; the uuid stays the key. The
 * client adds the prefix in its own words ("OT-0007", "WO-0007"). Every record
 * the server holds has one. Null is for a record the client holds before it
 * reaches the server (captured offline), which shows as "number pending".
 */
export const maintenanceRecordNumber = z.number().int().positive().nullable();

/**
 * An asset seen from the maintenance module: identity plus the two labels the
 * fleet is read by, same pair the asset list publishes. Registration is null
 * for anything not yet plated.
 */
export const maintenanceAssetRef = z.object({
  id: z.uuid(),
  assetCode: z.string(),
  registrationNumber: z.string().nullable(),
});

/**
 * Neither a work order nor an issue carries a branch column: the asset's branch
 * is the branch, and it is what the branch lens filters on. Resolved server-side
 * so a client never has to join the fleet to render a row.
 */
export const maintenanceBranchRef = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});

/**
 * The signalement a work order answers — absent for preventive work. Safety
 * criticality travels with the link rather than beside it: without an issue the
 * question does not arise, and a bare `false` would read as "checked, safe".
 */
export const workOrderIssueRef = z.object({
  id: z.uuid(),
  number: maintenanceRecordNumber,
  safetyCritical: z.boolean(),
});

export const WORK_ORDER_COST_TO_COME_REASONS = ["INVOICE_PENDING", "DECLARED_NOT_RECORDED"] as const;

/**
 * A completed order whose cost is still to come (#82), derived on every read
 * and never stored:
 *
 * - `INVOICE_PENDING`: closed with "invoice pending", and no cost line recorded
 *   after the close has been approved yet.
 * - `DECLARED_NOT_RECORDED`: a v1 close typed an amount, and the approved
 *   lines (`recordedCostMinor`) are still below it ("declared 50 000,
 *   recorded 0").
 *
 * Only approved lines settle it, so a late invoice awaiting review keeps the
 * order flagged; `awaitingApproval` says one is waiting (for an "invoice
 * pending" close, one recorded after the close).
 */
export const workOrderCostToCome = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("INVOICE_PENDING"),
    awaitingApproval: z.boolean(),
  }),
  z.object({
    reason: z.literal("DECLARED_NOT_RECORDED"),
    declaredCostMinor: z.number().int(),
    recordedCostMinor: z.number().int(),
    awaitingApproval: z.boolean(),
  }),
]);

/**
 * No `sort`: a work-order queue has one meaningful order (newest first) and it
 * is fixed server-side. The cursor still carries it, because `decodeKeysetCursor`
 * refuses a boundary minted under any other ordering.
 */
export const workOrderListQuery = listQuery({
  status: workOrderStatus.optional(),
  branchId: z.uuid().optional(),
  assetId: z.uuid().optional(),
});

export const workOrderListItem = z.object({
  id: z.uuid(),
  number: maintenanceRecordNumber,
  status: workOrderStatus,
  description: z.string(),
  asset: maintenanceAssetRef,
  branch: maintenanceBranchRef,
  /**
   * Minor units, XAF exponent 0 — the client formats, it never divides. This
   * and the other two amounts are null for a caller who may not read
   * work-order costs (`canReadWorkOrderCosts`, #390).
   */
  expectedCostMinor: z.number().int().nullable(),
  /**
   * What the repair cost: the sum of the order's non-rejected cost lines (#81),
   * pending ones included, signed so a reversal pair nets out. Derived, never
   * typed. Null until the work is declared complete.
   */
  actualCostMinor: z.number().int().nullable(),
  /**
   * The amount a v1 close typed. Kept as the closer's declaration only — it
   * never reached the books. Null for every v2 close.
   */
  declaredCostMinor: z.number().int().nullable(),
  /** What the closer said about the cost; null before completion and for v1 closes. */
  costOutcome: workOrderCostOutcome.nullable(),
  /**
   * Set while a completed order still has cost to come (#82). Null otherwise,
   * and for a caller who may not read work-order costs.
   */
  costToCome: workOrderCostToCome.nullable(),
  currency: z.string().length(3),
  issue: workOrderIssueRef.nullable(),
  /** The work order row has no timestamp of its own; this is when its creating command executed. */
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  rowVersion: z.number().int().positive(),
  /** Who created the order — the maker approve-work-order refuses. */
  createdBy: historyActor,
  /**
   * Who declared the work complete, while that declaration stands
   * (COMPLETION_SUBMITTED or COMPLETED) — the maker the closure approval and
   * a safety-critical release refuse. Null in every other status.
   */
  completedBy: historyActor.nullable(),
});

export const workOrderListResponse = listResponse(workOrderListItem);

/**
 * The audit event types the maintenance commands write against a work order —
 * the vocabulary a client needs labels for. The chronologie's `kind` is NOT
 * validated against this list: like the history read, the timeline never
 * enumerates event types, so a kind added later still renders (raw) instead of
 * failing the whole response.
 */
export const WORK_ORDER_EVENT_KINDS = [
  "work_order.created",
  "work_order.submitted",
  "work_order.approved",
  "work_order.rejected",
  "work_order.completion_submitted",
  "work_order.completed",
  "work_order.completion_approved",
  "work_order.completion_rejected",
  "work_order.cancelled",
  "work_order.asset_released",
  /**
   * Written before #28 renamed the states. Audit events are append-only, so a
   * database that ran the earlier maintenance candidate keeps them forever and
   * the client still needs their labels.
   */
  "work_order.opened",
  "work_order.closure_submitted",
  "work_order.closed",
  "work_order.closure_approved",
] as const;

export type WorkOrderEventKind = (typeof WORK_ORDER_EVENT_KINDS)[number];

/**
 * One step of the work order's life, lifted from the audit trail. Stable codes
 * only — the sentence is the client's job, in its own locale.
 */
export const workOrderChronologieEvent = z.object({
  eventId: z.uuid(),
  /** Open set; `WORK_ORDER_EVENT_KINDS` is the known vocabulary, not a bound. */
  kind: z.string(),
  occurredAt: z.iso.datetime(),
  /** Masked for PLATFORM actors exactly as the history timeline masks them. */
  actor: historyActor,
  /**
   * The decision's reason or note, through the same allowlist the record
   * history reads (`noteSql`), so the two timelines can't disagree.
   */
  note: z.string().nullable(),
  /** A reason picked from a list (#426): a code the client words. */
  noteCode: z.string().nullable(),
});

const costLineFields = {
  postingId: z.uuid(),
  entryId: z.uuid(),
  entryNumber: z.string(),
  description: z.string().nullable(),
  /** SIGNED minor units: a reversal's line subtracts. */
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  economicDate: z.iso.date(),
};

/**
 * Labour and parts booked against this repair: one line per posting carrying the
 * work order (§4.2), never a second entry. The posted set is POSTED lines plus
 * both halves of a reversal — the REVERSED original and its negative
 * counterpart — so the lines sum to what the repair actually cost.
 */
export const workOrderCostLine = z.object({
  ...costLineFields,
  entryStatus: z.enum(["POSTED", "REVERSED"]),
});

/** Awaiting finance review: recorded, not spent. Never summed into the posted set. */
export const workOrderPendingCostLine = z.object({
  ...costLineFields,
  entryStatus: z.literal("SUBMITTED"),
});

export const workOrderDetail = workOrderListItem.extend({
  summary: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** Why the spend was refused (terminal REJECTED). */
  rejectReason: z.string().nullable(),
  /**
   * Why the last declared completion was sent back. Kept while the order is
   * APPROVED again, so the workshop sees what to fix before resubmitting.
   */
  completionRejectReason: z.string().nullable(),
  /** The flag a held completion carries until it is approved or sent back. */
  resolveLinkedIssue: z.boolean(),
  /** §3.4 provenance: the command that first wrote the row. */
  createdByCommandId: z.uuid(),
  /** Time-ordered, oldest first — a life story reads forwards. */
  chronologie: z.array(workOrderChronologieEvent),
  /**
   * Only postings in the reader's branch scope: a cost line is a financial
   * record, and its entry's branch is what finance scope is read against.
   * REJECTED entries are excluded — they record a spend that was refused.
   * Null, never an empty list, when the caller may not read work-order costs
   * (`canReadWorkOrderCosts`, #390).
   */
  costLines: z.array(workOrderCostLine).nullable(),
  pendingCostLines: z.array(workOrderPendingCostLine).nullable(),
});

const queryBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const issueListQuery = listQuery({
  branchId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  safetyCritical: queryBoolean.optional(),
  status: issueStatus.optional(),
});

/** A work order spawned by this signalement; an issue may spawn several. */
export const issueWorkOrderRef = z.object({
  id: z.uuid(),
  number: maintenanceRecordNumber,
  status: workOrderStatus,
});

export const issueListItem = z.object({
  id: z.uuid(),
  number: maintenanceRecordNumber,
  asset: maintenanceAssetRef,
  branch: maintenanceBranchRef,
  description: z.string(),
  safetyCritical: z.boolean(),
  category: z.string().nullable(),
  reportedAt: z.iso.datetime(),
  status: issueStatus,
  resolvedAt: z.iso.datetime().nullable(),
  resolutionNote: z.string().nullable(),
  dismissedAt: z.iso.datetime().nullable(),
  dismissReason: z.string().nullable(),
  workOrders: z.array(issueWorkOrderRef),
  /**
   * Whether the ASSET is grounded right now — an open availability interval,
   * whatever opened it. Availability is not lifecycle status and not a property
   * of this issue: a second signalement on an already-grounded truck reads
   * `true` without having opened anything itself.
   */
  assetUnavailable: z.boolean(),
  rowVersion: z.number().int().positive(),
});

export const issueListResponse = listResponse(issueListItem);

/** One signalement, for a deep link: the list row plus its trail and files. */
export const issueDetail = issueListItem.extend({
  /** Its audit events, oldest first — reported, then resolved or dismissed. */
  chronologie: z.array(workOrderChronologieEvent),
  /** Photos attached when it was reported. */
  artifactCount: z.number().int().nonnegative(),
  /**
   * Those photos, oldest first. Download each through
   * `GET /v1/issues/:issueId/artifacts/:artifactId/download-url`.
   */
  artifacts: z.array(recordArtifact),
  /** Who resolved or dismissed it; null while OPEN. */
  closedBy: historyActor.nullable(),
});

export type WorkOrderStatus = z.infer<typeof workOrderStatus>;
export type WorkOrderCostToCome = z.infer<typeof workOrderCostToCome>;
export type IssueStatus = z.infer<typeof issueStatus>;
export type WorkOrderPendingCostLine = z.infer<typeof workOrderPendingCostLine>;
export type WorkOrderListQuery = z.infer<typeof workOrderListQuery>;
export type WorkOrderListItem = z.infer<typeof workOrderListItem>;
export type WorkOrderListResponse = z.infer<typeof workOrderListResponse>;
export type WorkOrderChronologieEvent = z.infer<typeof workOrderChronologieEvent>;
export type WorkOrderCostLine = z.infer<typeof workOrderCostLine>;
export type WorkOrderDetail = z.infer<typeof workOrderDetail>;
export type IssueListQuery = z.infer<typeof issueListQuery>;
export type IssueListItem = z.infer<typeof issueListItem>;
export type IssueListResponse = z.infer<typeof issueListResponse>;
export type IssueDetail = z.infer<typeof issueDetail>;

/** Narrows the workshop counts like the lists: inside the caller's scope, never wider. */
export const maintenanceSummaryQuery = z.object({
  branchId: z.uuid().optional(),
});

/**
 * The Maintenance overview, counted in SQL over the caller's workspace and
 * branch scope (the asset's branch). `openIssues` equals what the issues list
 * shows for `status=OPEN`, `approvedWorkOrders` what the work-order list shows
 * for `status=APPROVED`. `grounded` counts vehicles holding an open
 * availability interval. `averageRepairDays` is the mean time from a work
 * order's creation to its completion over the orders completed in the last
 * `repairWindowDays` days, to one decimal; null when none completed.
 */
export const maintenanceSummary = z.object({
  openIssues: z.number().int().nonnegative(),
  openSafetyCritical: z.number().int().nonnegative(),
  grounded: z.number().int().nonnegative(),
  approvedWorkOrders: z.number().int().nonnegative(),
  averageRepairDays: z.number().nonnegative().nullable(),
  repairsCounted: z.number().int().nonnegative(),
  repairWindowDays: z.number().int().positive(),
});

export type MaintenanceSummaryQuery = z.infer<typeof maintenanceSummaryQuery>;
export type MaintenanceSummary = z.infer<typeof maintenanceSummary>;
