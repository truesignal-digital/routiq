import { z } from "zod";
import { moneyMinor } from "../envelope.js";
import { ROLES } from "../roles.js";
import { approvalChain } from "./approval-chain.js";

/** One role's own chain, per entry kind it may record. */
export const roleApprovalChain = z.object({
  role: z.enum(ROLES),
  chains: z.array(approvalChain),
});

/**
 * A rule kept to one branch or one category. The settings screen moves only
 * the workspace-wide bands, so these keep their own amounts and are listed
 * apart.
 */
export const approvalRuleOverride = z.object({
  commandType: z.string(),
  branchName: z.string().nullable(),
  categoryCode: z.string().nullable(),
  amountMinMinor: moneyMinor.nullable(),
  amountMaxMinor: moneyMinor.nullable(),
  requiredRole: z.enum(ROLES),
});

/**
 * `GET /v1/approval-thresholds`, Direction only (#354): the two bands of the
 * money chain, what each role's own entries now do, the exceptions the bands
 * leave alone, who is told when they move, and the last change.
 */
export const approvalThresholdsResponse = z.object({
  currency: z.string(),
  /** The envelope's `expectedVersion` for `update-approval-threshold` v2. */
  version: z.number().int(),
  /** Null when the workspace has no such band (rules edited by hand). */
  recordingThresholdMinor: moneyMinor.nullable(),
  financeCeilingMinor: moneyMinor.nullable(),
  roles: z.array(roleApprovalChain),
  overrides: z.array(approvalRuleOverride),
  /** The roles that see the rules notice after a change (#422). */
  affectedRoles: z.array(z.enum(ROLES)),
  lastChange: z
    .object({
      changedAt: z.iso.datetime(),
      /** Null when ROUTIQ changed the rules itself (a release). */
      changedBy: z.string().nullable(),
    })
    .nullable(),
});

export type RoleApprovalChain = z.infer<typeof roleApprovalChain>;
export type ApprovalRuleOverride = z.infer<typeof approvalRuleOverride>;
export type ApprovalThresholdsResponse = z.infer<typeof approvalThresholdsResponse>;
