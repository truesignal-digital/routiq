import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

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
