import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Refuses the spend a threshold rule held back: SUBMITTED → REJECTED, a
 * terminal state. The pair of approve-work-order, with the same maker/checker
 * split; the reason is required because the workshop has to know what to ask
 * for instead.
 */
export const rejectWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  reason: z.string().min(1).max(500),
});

export const rejectWorkOrderCommand = z.object({
  name: z.literal("reject-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: rejectWorkOrderPayload,
});

export type RejectWorkOrderPayload = z.infer<typeof rejectWorkOrderPayload>;
export type RejectWorkOrderCommand = z.infer<typeof rejectWorkOrderCommand>;
