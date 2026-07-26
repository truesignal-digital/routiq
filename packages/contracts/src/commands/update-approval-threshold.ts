import { z } from "zod";
import { commandEnvelope, moneyMinor } from "../envelope.js";

export const updateApprovalThresholdPayload = z.object({
  commandType: z.enum(["record-revenue", "record-expense"]),
  amountMaxMinor: moneyMinor.min(0),
});

export const updateApprovalThresholdCommand = z.object({
  name: z.literal("update-approval-threshold"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: updateApprovalThresholdPayload,
});

export type UpdateApprovalThresholdPayload = z.infer<
  typeof updateApprovalThresholdPayload
>;
export type UpdateApprovalThresholdCommand = z.infer<
  typeof updateApprovalThresholdCommand
>;
