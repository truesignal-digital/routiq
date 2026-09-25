import { z } from "zod";
import { commandEnvelope, currencyCode, moneyMinor } from "../envelope.js";

export const createWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  assetId: z.uuid(),
  issueId: z.uuid().optional(),
  description: z.string().min(1).max(500),
  expectedCostMinor: moneyMinor.nonnegative().optional(),
  currency: currencyCode.default("XAF"),
});

export const createWorkOrderCommand = z.object({
  name: z.literal("create-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: createWorkOrderPayload,
});

export type CreateWorkOrderCommand = z.infer<typeof createWorkOrderCommand>;
