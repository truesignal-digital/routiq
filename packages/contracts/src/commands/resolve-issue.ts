import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Closes a signalement as dealt with: OPEN → RESOLVED. The standalone path is
 * the fault fixed on the spot, with no work order behind it; a completed work
 * order resolves its issue through `complete-work-order`'s flag instead. Either
 * way it says nothing about availability — only a release puts a grounded asset
 * back on the road.
 */
export const resolveIssuePayload = z.object({
  issueId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});

export const resolveIssueCommand = z.object({
  name: z.literal("resolve-issue"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: resolveIssuePayload,
});

export type ResolveIssuePayload = z.infer<typeof resolveIssuePayload>;
export type ResolveIssueCommand = z.infer<typeof resolveIssueCommand>;
