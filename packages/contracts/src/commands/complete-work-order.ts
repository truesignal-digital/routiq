import { z } from "zod";
import { commandEnvelope, currencyCode, moneyMinor } from "../envelope.js";

export const completeWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  actualCostMinor: moneyMinor.nonnegative().optional(),
  currency: currencyCode.default("XAF"),
  summary: z.string().min(1).max(500).optional(),
});

export const completeWorkOrderCommand = z.object({
  name: z.literal("complete-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: completeWorkOrderPayload,
});

export type CompleteWorkOrderCommand = z.infer<typeof completeWorkOrderCommand>;
