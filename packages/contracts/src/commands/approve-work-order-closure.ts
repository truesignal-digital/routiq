import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Accepts the completion the workshop declared: COMPLETION_SUBMITTED →
 * COMPLETED. The name predates the owner's vocabulary (#28) and is kept because
 * it is the wire contract; the semantics are "approve the completion". The
 * approver may not be the member who declared it — the same maker/checker
 * split the financial entries use.
 */
export const approveWorkOrderClosurePayload = z.object({
  workOrderId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});

export const approveWorkOrderClosureCommand = z.object({
  name: z.literal("approve-work-order-closure"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: approveWorkOrderClosurePayload,
});

export type ApproveWorkOrderClosureCommand = z.infer<
  typeof approveWorkOrderClosureCommand
>;
