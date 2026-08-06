import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * One command for both directions rather than deactivate/reactivate pairs: a
 * branch has exactly one flag, and the target state is what the admin picked on
 * screen. A workspace must keep at least one active branch (`LAST_BRANCH`).
 */
export const setBranchStatusPayload = z.strictObject({
  branchId: z.uuid(),
  active: z.boolean(),
});

export const setBranchStatusCommand = z.strictObject({
  name: z.literal("set-branch-status"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: setBranchStatusPayload,
});

export type SetBranchStatusCommand = z.infer<typeof setBranchStatusCommand>;
export type SetBranchStatusPayload = z.infer<typeof setBranchStatusPayload>;
