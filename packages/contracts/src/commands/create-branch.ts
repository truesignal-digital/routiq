import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { branchCode, branchName } from "./branch-fields.js";

export const createBranchPayload = z.strictObject({
  branchId: z.uuid(),
  code: branchCode,
  name: branchName,
  timezone: z.string().min(1).max(100).optional(),
});

export const createBranchCommand = z.strictObject({
  name: z.literal("create-branch"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: createBranchPayload,
});

export type CreateBranchCommand = z.infer<typeof createBranchCommand>;
export type CreateBranchPayload = z.infer<typeof createBranchPayload>;
