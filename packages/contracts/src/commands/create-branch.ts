import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * The branch field rules, exported so create-branch, rename-branch and
 * provisioning share one spelling rather than three that must be kept in step —
 * a branch born at provisioning and one added later are the same row. Clients
 * validate against these too, so a name the dialog accepts is a name the server
 * accepts.
 *
 * The code is immutable once numbering has embedded it (`DLA-2026-00004`).
 */
export const branchCode = z.string().regex(/^[A-Z0-9]{2,8}$/);

/**
 * Trimmed before the length check, so `'   '` is an empty name rather than a
 * three-character one: a blank branch renders as a blank row in the switcher
 * and cannot be told apart from any other blank-named branch.
 */
export const branchName = z.string().trim().min(1).max(120);

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
