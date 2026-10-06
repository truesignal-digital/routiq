import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * A member's "I have read the new approval rules" (#422). The member is the
 * session's; the payload names only the change they were shown, so a notice
 * dismissed on one device stays dismissed on every other.
 */
export const acknowledgeApprovalRulesPayload = z.strictObject({
  changeId: z.uuid(),
});

export const acknowledgeApprovalRulesCommand = z.object({
  name: z.literal("acknowledge-approval-rules"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: acknowledgeApprovalRulesPayload,
});

export type AcknowledgeApprovalRulesPayload = z.infer<typeof acknowledgeApprovalRulesPayload>;
export type AcknowledgeApprovalRulesCommand = z.infer<typeof acknowledgeApprovalRulesCommand>;
