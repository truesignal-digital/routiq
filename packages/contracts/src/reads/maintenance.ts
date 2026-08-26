import { z } from "zod";
import { historyActor } from "./history.js";
import { listQuery, listResponse } from "./list.js";

export const workOrderStatuses = [
  "SUBMITTED",
  "OPEN",
  "PENDING_CLOSE",
  "CLOSED",
  "CANCELLED",
] as const;
export const workOrderStatus = z.enum(workOrderStatuses);

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
  safetyCritical: z.boolean(),
});

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
  status: workOrderStatus,
  description: z.string(),
  asset: maintenanceAssetRef,
  branch: maintenanceBranchRef,
  /** Minor units, XAF exponent 0 — the client formats, it never divides. */
  expectedCostMinor: z.number().int().nullable(),
  actualCostMinor: z.number().int().nullable(),
  currency: z.string().length(3),
  issue: workOrderIssueRef.nullable(),
  /** The work order row has no timestamp of its own; this is when its creating command executed. */
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  rowVersion: z.number().int().positive(),
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
  "work_order.submitted",
  "work_order.opened",
  "work_order.approved",
  "work_order.closure_submitted",
  "work_order.closed",
  "work_order.closure_approved",
  "work_order.cancelled",
  "work_order.asset_released",
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
});

/**
 * Labour and parts booked against this repair: one line per posting carrying the
 * work order (§4.2), never a second entry. The entry's status travels with it so
 * a submitted-but-unapproved cost is not read as spent.
 */
export const workOrderCostLine = z.object({
  postingId: z.uuid(),
  entryId: z.uuid(),
  entryNumber: z.string(),
  description: z.string().nullable(),
  /** SIGNED minor units: a reversal's line subtracts. */
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  economicDate: z.iso.date(),
  entryStatus: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]),
});

export const workOrderDetail = workOrderListItem.extend({
  summary: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** §3.4 provenance: the command that first wrote the row. */
  createdByCommandId: z.uuid(),
  /** Time-ordered, oldest first — a life story reads forwards. */
  chronologie: z.array(workOrderChronologieEvent),
  costLines: z.array(workOrderCostLine),
});

const queryBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const issueListQuery = listQuery({
  branchId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  safetyCritical: queryBoolean.optional(),
});

/** A work order spawned by this signalement; an issue may spawn several. */
export const issueWorkOrderRef = z.object({
  id: z.uuid(),
  status: workOrderStatus,
});

export const issueListItem = z.object({
  id: z.uuid(),
  asset: maintenanceAssetRef,
  branch: maintenanceBranchRef,
  description: z.string(),
  safetyCritical: z.boolean(),
  category: z.string().nullable(),
  reportedAt: z.iso.datetime(),
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

export type WorkOrderStatus = z.infer<typeof workOrderStatus>;
export type WorkOrderListQuery = z.infer<typeof workOrderListQuery>;
export type WorkOrderListItem = z.infer<typeof workOrderListItem>;
export type WorkOrderListResponse = z.infer<typeof workOrderListResponse>;
export type WorkOrderChronologieEvent = z.infer<typeof workOrderChronologieEvent>;
export type WorkOrderCostLine = z.infer<typeof workOrderCostLine>;
export type WorkOrderDetail = z.infer<typeof workOrderDetail>;
export type IssueListQuery = z.infer<typeof issueListQuery>;
export type IssueListItem = z.infer<typeof issueListItem>;
export type IssueListResponse = z.infer<typeof issueListResponse>;
