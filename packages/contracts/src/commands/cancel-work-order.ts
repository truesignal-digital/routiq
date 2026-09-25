import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Calls a work order off from SUBMITTED, APPROVED or COMPLETION_SUBMITTED. The
 * reason is required; costs already posted against the order stand — abandoning
 * a repair does not unspend money — and are corrected, if at all, by reversal.
 */
export const cancelWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  reason: z.string().min(1).max(500),
});

export const cancelWorkOrderCommand = z.object({
  name: z.literal("cancel-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: cancelWorkOrderPayload,
});

export type CancelWorkOrderCommand = z.infer<typeof cancelWorkOrderCommand>;
