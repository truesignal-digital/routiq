import { z } from "zod";
import { commandEnvelope, currencyCode, moneyMinor } from "../envelope.js";

const nonNegativeMoneyMinor = moneyMinor.nonnegative().max(Number.MAX_SAFE_INTEGER);

export const workOrderStatuses = [
  "SUBMITTED",
  "APPROVED",
  "COMPLETION_SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;
export const workOrderStatus = z.enum(workOrderStatuses);

/**
 * create-work-order.v1 (§5.1, lifecycle #28). The approval rule matches on
 * `expectedCostMinor` — spend authorization: below the band the WO enters
 * APPROVED directly, above it SUBMITTED. No DRAFT and no IN_PROGRESS exist.
 * A zero expected cost is legal (in-house labor already paid monthly).
 */
export const createWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  assetId: z.uuid(),
  /** At most one Signalement; several issues in one visit = several WOs. */
  issueId: z.uuid().optional(),
  description: z.string().min(1).max(2000),
  expectedCostMinor: nonNegativeMoneyMinor,
  currency: currencyCode.default("XAF"),
  /** Roadside work is often recorded after the fact — the date may predate the sync. */
  openedAt: z.iso.datetime({ offset: true }).optional(),
});

export const approveWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});

export const rejectWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  reason: z.string().min(1).max(500),
});

/**
 * complete-work-order.v1 — the completion gate re-evaluates the approval rule
 * on the ACTUAL posted total (computed server-side from the WO's postings,
 * catching aggregate creep): below the band the WO lands COMPLETED, above it
 * COMPLETION_SUBMITTED with these facts held until the approver decides.
 * `resolveLinkedIssue` piggybacks the issue closure — the UI pre-checks it when
 * the WO references an issue; unchecking records "work done, problem persists".
 */
export const completeWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  completedAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().min(1).max(2000).optional(),
  resolveLinkedIssue: z.boolean().default(false),
});

/** cancel-work-order.v1 — from any non-terminal state; posted costs stand. */
export const cancelWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  reason: z.string().min(1).max(500),
});

/**
 * release-asset-to-service.v1 (fr: Remise en service) — closes the asset's open
 * UNAVAILABLE interval, and nothing else: issue state is deliberately untouched
 * (§3.4 inv. 8). Always a human decision — never queued offline, never an AI
 * principal — and for safety-critical work the releaser must not be the
 * performer.
 */
export const releaseAssetToServicePayload = z.object({
  assetId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
  releasedAt: z.iso.datetime({ offset: true }).optional(),
});

export const createWorkOrderCommand = z.object({
  name: z.literal("create-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: createWorkOrderPayload,
});

export const approveWorkOrderCommand = z.object({
  name: z.literal("approve-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: approveWorkOrderPayload,
});

export const rejectWorkOrderCommand = z.object({
  name: z.literal("reject-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: rejectWorkOrderPayload,
});

export const completeWorkOrderCommand = z.object({
  name: z.literal("complete-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: completeWorkOrderPayload,
});

export const cancelWorkOrderCommand = z.object({
  name: z.literal("cancel-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: cancelWorkOrderPayload,
});

export const releaseAssetToServiceCommand = z.object({
  name: z.literal("release-asset-to-service"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: releaseAssetToServicePayload,
});

export type WorkOrderStatus = (typeof workOrderStatuses)[number];
export type CreateWorkOrderPayload = z.infer<typeof createWorkOrderPayload>;
export type ApproveWorkOrderPayload = z.infer<typeof approveWorkOrderPayload>;
export type RejectWorkOrderPayload = z.infer<typeof rejectWorkOrderPayload>;
export type CompleteWorkOrderPayload = z.infer<typeof completeWorkOrderPayload>;
export type CancelWorkOrderPayload = z.infer<typeof cancelWorkOrderPayload>;
export type ReleaseAssetToServicePayload = z.infer<typeof releaseAssetToServicePayload>;
export type CreateWorkOrderCommand = z.infer<typeof createWorkOrderCommand>;
export type ApproveWorkOrderCommand = z.infer<typeof approveWorkOrderCommand>;
export type RejectWorkOrderCommand = z.infer<typeof rejectWorkOrderCommand>;
export type CompleteWorkOrderCommand = z.infer<typeof completeWorkOrderCommand>;
export type CancelWorkOrderCommand = z.infer<typeof cancelWorkOrderCommand>;
export type ReleaseAssetToServiceCommand = z.infer<typeof releaseAssetToServiceCommand>;
