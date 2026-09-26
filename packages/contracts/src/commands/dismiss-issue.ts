import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Closes a signalement that should not have been raised — reported in error,
 * a duplicate, nothing found. OPEN → DISMISSED. The reason is required: a
 * dismissal is a judgement against someone's report, and the trail has to say
 * why it was overruled.
 */
export const dismissIssuePayload = z.object({
  issueId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const dismissIssueCommand = z.object({
  name: z.literal("dismiss-issue"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: dismissIssuePayload,
});

export type DismissIssuePayload = z.infer<typeof dismissIssuePayload>;
export type DismissIssueCommand = z.infer<typeof dismissIssueCommand>;
