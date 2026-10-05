import { z } from "zod";
import { commandEnvelope, moneyMinor } from "../envelope.js";

/**
 * The command types whose auto-approval band a tenant may move. The work-order
 * pair matches on expected cost (creation) and actual total (completion); their
 * catalog defaults carry no band, so the first threshold a workspace sets turns
 * the unbounded defaults into one. `approve-entry` is the amount up to which
 * Finance decides a pending entry (1 000 000 XAF by default); it moves the
 * reject-entry band with it.
 */
export const APPROVAL_THRESHOLD_COMMAND_TYPES = [
  "record-revenue",
  "record-expense",
  "create-work-order",
  "complete-work-order",
  "approve-entry",
] as const;

export const updateApprovalThresholdPayload = z.object({
  commandType: z.enum(APPROVAL_THRESHOLD_COMMAND_TYPES),
  amountMaxMinor: moneyMinor.min(0),
});

export const updateApprovalThresholdCommand = z.object({
  name: z.literal("update-approval-threshold"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: updateApprovalThresholdPayload,
});

export type ApprovalThresholdCommandType =
  (typeof APPROVAL_THRESHOLD_COMMAND_TYPES)[number];
export type UpdateApprovalThresholdPayload = z.infer<
  typeof updateApprovalThresholdPayload
>;
export type UpdateApprovalThresholdCommand = z.infer<
  typeof updateApprovalThresholdCommand
>;
