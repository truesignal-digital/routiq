import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Authorizes the expected spend on a work order that landed SUBMITTED because
 * a threshold rule required review. SUBMITTED → APPROVED, which is open work:
 * costs attach from here on. Kept separate from approve-work-order-closure
 * because the two carry different audit meanings: this one commits the
 * workshop to the job, that one accepts what it cost.
 */
export const approveWorkOrderPayload = z.object({
  workOrderId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});

export const approveWorkOrderCommand = z.object({
  name: z.literal("approve-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: approveWorkOrderPayload,
});

export type ApproveWorkOrderCommand = z.infer<typeof approveWorkOrderCommand>;
