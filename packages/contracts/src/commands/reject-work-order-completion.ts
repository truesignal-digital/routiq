import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Sends a declared completion back: COMPLETION_SUBMITTED → APPROVED. The work
 * stays open — costs can be corrected and the completion resubmitted — so this
 * is not a terminal refusal the way reject-work-order is.
 */
export const rejectWorkOrderCompletionPayload = z.object({
  workOrderId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const rejectWorkOrderCompletionCommand = z.object({
  name: z.literal("reject-work-order-completion"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: rejectWorkOrderCompletionPayload,
});

export type RejectWorkOrderCompletionPayload = z.infer<
  typeof rejectWorkOrderCompletionPayload
>;
export type RejectWorkOrderCompletionCommand = z.infer<
  typeof rejectWorkOrderCompletionCommand
>;
