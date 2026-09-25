import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Accepts the actual costs declared when the work was completed.
 * PENDING_CLOSE → CLOSED. The approver may not be the member who declared the
 * completion — the same maker/checker split the financial entries use.
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
