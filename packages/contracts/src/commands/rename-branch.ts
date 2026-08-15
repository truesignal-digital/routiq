import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { branchName } from "./branch-fields.js";

/**
 * `code` is deliberately absent: it is the natural key embedded in record
 * numbering (`DLA-2026-00004`), so renaming a branch changes its display name
 * and nothing a printed waybill already carries.
 */
export const renameBranchPayload = z.strictObject({
  branchId: z.uuid(),
  name: branchName,
});

export const renameBranchCommand = z.strictObject({
  name: z.literal("rename-branch"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: renameBranchPayload,
});

export type RenameBranchCommand = z.infer<typeof renameBranchCommand>;
export type RenameBranchPayload = z.infer<typeof renameBranchPayload>;
