import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * report-issue.v1 (§5.1, lifecycle #28) — capture a defect/breakdown/incident
 * against an asset. `safetyCritical` is the reporter's CONFIRMED flag: the UI
 * pre-checks it from the issue category's tenant-editable default, the reporter
 * overrides either way, and the submitted value is what opens the UNAVAILABLE
 * interval — the interval always traces to a human assertion, and the capture
 * works offline.
 */
export const reportIssuePayload = z.object({
  issueId: z.uuid(),
  assetId: z.uuid(),
  categoryCode: z.string().min(1).max(80),
  description: z.string().min(1).max(2000).optional(),
  safetyCritical: z.boolean().default(false),
  /** When the problem was observed — offline capture may predate the sync. */
  reportedAt: z.iso.datetime({ offset: true }).optional(),
});

/** resolve-issue.v1 — fixed on the spot, no work order. OPEN → RESOLVED. */
export const resolveIssuePayload = z.object({
  issueId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});

/** dismiss-issue.v1 — reported in error. OPEN → DISMISSED; the reason is kept. */
export const dismissIssuePayload = z.object({
  issueId: z.uuid(),
  reason: z.string().min(1).max(500),
});

export const reportIssueCommand = z.object({
  name: z.literal("report-issue"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reportIssuePayload,
});

export const resolveIssueCommand = z.object({
  name: z.literal("resolve-issue"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: resolveIssuePayload,
});

export const dismissIssueCommand = z.object({
  name: z.literal("dismiss-issue"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: dismissIssuePayload,
});

export type ReportIssuePayload = z.infer<typeof reportIssuePayload>;
export type ResolveIssuePayload = z.infer<typeof resolveIssuePayload>;
export type DismissIssuePayload = z.infer<typeof dismissIssuePayload>;
export type ReportIssueCommand = z.infer<typeof reportIssueCommand>;
export type ResolveIssueCommand = z.infer<typeof resolveIssueCommand>;
export type DismissIssueCommand = z.infer<typeof dismissIssueCommand>;
