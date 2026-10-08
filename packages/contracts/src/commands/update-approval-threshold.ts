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

/**
 * Version 2 moves the whole money chain at once (#354): the recording
 * threshold, up to which an entry posts without review, and the Finance
 * ceiling, up to which Finance decides a pending one. Above the ceiling only
 * Direction decides. Both bands move in one transaction, so the chain is never
 * seen half-changed. The envelope's `expectedVersion` is the `version` the
 * approval-thresholds read returned.
 */
export const updateApprovalThresholdV2Payload = z.object({
  recordingThresholdMinor: moneyMinor.min(0),
  financeCeilingMinor: moneyMinor.min(1),
});

export const updateApprovalThresholdV2Command = z.object({
  name: z.literal("update-approval-threshold"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: updateApprovalThresholdV2Payload,
});

/** Refused when the recording threshold is not below the Finance ceiling. */
export const RECORDING_THRESHOLD_NOT_BELOW_CEILING = "RECORDING_THRESHOLD_NOT_BELOW_CEILING";

/** The rule between the two bands, shared by the command and the settings form. */
export function thresholdBandsProblem(
  bands: UpdateApprovalThresholdV2Payload,
): typeof RECORDING_THRESHOLD_NOT_BELOW_CEILING | undefined {
  return bands.recordingThresholdMinor < bands.financeCeilingMinor
    ? undefined
    : RECORDING_THRESHOLD_NOT_BELOW_CEILING;
}

export type UpdateApprovalThresholdV2Payload = z.infer<typeof updateApprovalThresholdV2Payload>;
export type UpdateApprovalThresholdV2Command = z.infer<typeof updateApprovalThresholdV2Command>;
