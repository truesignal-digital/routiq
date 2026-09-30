import { z } from "zod";
import { commandEnvelope, currencyCode, moneyMinor } from "../envelope.js";

export const completeWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  actualCostMinor: moneyMinor.nonnegative().optional(),
  currency: currencyCode.default("XAF"),
  summary: z.string().min(1).max(500).optional(),
  /**
   * Resolve the signalement this order answers, in the same transaction as the
   * completion (or its approval, when the completion is held for review).
   * Omitted means "yes" whenever the order cites an issue — the UI pre-checks
   * it — and a human unchecks it when the work is done but the problem is not.
   * Meaningless, and ignored, on preventive work with no issue behind it.
   */
  resolveLinkedIssue: z.boolean().optional(),
});

export const completeWorkOrderCommand = z.object({
  name: z.literal("complete-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: completeWorkOrderPayload,
});

export type CompleteWorkOrderCommand = z.infer<typeof completeWorkOrderCommand>;
