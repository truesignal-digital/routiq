import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { branchCode, branchName } from "./create-branch.js";
import { TEMPLATE_CODES } from "../templates.js";
import { TOGGLEABLE_MODULE_CODES } from "../modules.js";
import { ROLES } from "../roles.js";

/** Same field rules as create-branch.v1 — literally, via the shared spellings. */
const provisionedBranch = z.strictObject({
  id: z.uuid(),
  code: branchCode,
  name: branchName,
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
   * provisioning takes the whole set. The uniqueness checks are the payload-side
   * half of the `(workspace_id, code)` index and of `branches_pkey`: a duplicate
   * must be a validation error naming the offending entry, not a constraint
   * violation part-way through the batch insert. Hand-authored tenant files get
   * their branch entries copy-pasted, and an operator who edits the code but not
   * the UUID would otherwise see a raw Postgres constraint name.
   */
  branches: z
    .array(provisionedBranch)
    .min(1, "At least one branch is required")
    .max(20, "At most 20 branches can be provisioned")
    .superRefine((entries, ctx) => {
      const seenCodes = new Set<string>();
      const seenIds = new Set<string>();
      entries.forEach((branch, index) => {
        if (seenCodes.has(branch.code)) {
          ctx.addIssue({
            code: "custom",
            message: "Branch codes must be unique within the payload",
            path: [index, "code"],
          });
        }
        seenCodes.add(branch.code);

        if (seenIds.has(branch.id)) {
          ctx.addIssue({
            code: "custom",
            message: "Branch ids must be unique within the payload",
            path: [index, "id"],
          });
        }
        seenIds.add(branch.id);
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
