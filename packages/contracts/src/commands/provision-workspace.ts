import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { TEMPLATE_CODES } from "../templates.js";
import { TOGGLEABLE_MODULE_CODES } from "../modules.js";
import { ROLES } from "../roles.js";

/**
 * Same field rules as create-branch.v1: a branch born at provisioning and one
 * added later are the same row, and the code is immutable once numbering has
 * embedded it (`DLA-2026-00004`).
 */
const provisionedBranch = z.strictObject({
  id: z.uuid(),
  code: z.string().regex(/^[A-Z0-9]{2,8}$/),
  name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(100).optional(),
});

const provisionedUser = z.strictObject({
  id: z.uuid(),
  username: z.string().min(1).max(80),
  displayName: z.string().min(1),
  pin: z.string().min(4).max(64),
  role: z.enum(ROLES),
  branchScope: z.union([
    z.literal("ALL"),
    z.array(z.string().min(1).max(40)),
  ]),
});

export const provisionWorkspacePayload = z.strictObject({
  workspace: z.strictObject({
    id: z.uuid(),
    slug: z.string().min(1).max(80).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphens"),
    name: z.string().min(1),
    defaultCurrency: z.enum(["XAF"]).optional().default("XAF"),
    timezone: z.string().optional().default("Africa/Douala"),
    defaultLocale: z.string().optional().default("fr-CM"),
  }),
  /**
   * A tenant is multi-branch from day one (Douala + Yaoundé + Bafoussam), so
   * provisioning takes the whole set. The unique-code check is the payload-side
   * half of the `(workspace_id, code)` index: a duplicate must be a validation
   * error naming the offending entry, not a constraint violation mid-insert.
   */
  branches: z
    .array(provisionedBranch)
    .min(1, "At least one branch is required")
    .max(20, "At most 20 branches can be provisioned")
    .superRefine((entries, ctx) => {
      const seen = new Set<string>();
      entries.forEach((branch, index) => {
        if (seen.has(branch.code)) {
          ctx.addIssue({
            code: "custom",
            message: "Branch codes must be unique within the payload",
            path: [index, "code"],
          });
          return;
        }
        seen.add(branch.code);
      });
    }),
  admin: z.strictObject({
    id: z.uuid(),
    displayName: z.string().min(1),
    username: z.string().min(1).max(80),
    pin: z.string().min(4).max(64),
  }),
  enabledPresets: z.array(z.enum(TEMPLATE_CODES)).min(1, "At least one preset must be enabled"),
  disabledModules: z.array(z.enum(TOGGLEABLE_MODULE_CODES)).default([]),
  users: z.array(provisionedUser).optional(),
});

export const provisionWorkspaceCommand = z.object({
  name: z.literal("provision-workspace"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: provisionWorkspacePayload,
});

export type ProvisionWorkspacePayload = z.infer<typeof provisionWorkspacePayload>;
export type ProvisionWorkspaceCommand = z.infer<typeof provisionWorkspaceCommand>;
