import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { branchCode, branchName } from "./branch-fields.js";
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
   * half of the `(workspace_id, code)` and `(workspace_id, name)` indexes and of
   * `branches_pkey`: a duplicate
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
      const seenNames = new Set<string>();
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

        if (seenNames.has(branch.name)) {
          ctx.addIssue({
            code: "custom",
            message: "Branch names must be unique within the payload",
            path: [index, "name"],
          });
        }
        seenNames.add(branch.name);
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

/**
 * v2 is the array shape above. v1 took a single `branch` object and a loose code
 * rule; a receipt filed under v1 can never match a v2 payload hash, and a tenant
 * file whose code is lowercase or longer than eight characters no longer even
 * validates. Both versions stay registered, per ARCHITECTURE.md §6 — the server
 * accepts the previous payload version for at least the refresh window.
 */
export const provisionWorkspaceCommand = z.object({
  name: z.literal("provision-workspace"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: provisionWorkspacePayload,
});

/**
 * Frozen: this is what already-written receipts and already-authored tenant
 * files say. Tightening it would change what an old file means, which is the
 * one thing a compatibility schema may not do — so the loose `code` rule and the
 * untrimmed name stay exactly as v1 shipped them.
 */
const legacyProvisionedBranch = z.strictObject({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
});

export const provisionWorkspaceV1Payload = z.strictObject({
  workspace: z.strictObject({
    id: z.uuid(),
    slug: z.string().min(1).max(80).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphens"),
    name: z.string().min(1),
    defaultCurrency: z.enum(["XAF"]).optional().default("XAF"),
    timezone: z.string().optional().default("Africa/Douala"),
    defaultLocale: z.string().optional().default("fr-CM"),
  }),
  branch: legacyProvisionedBranch,
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

export const provisionWorkspaceV1Command = z.object({
  name: z.literal("provision-workspace"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: provisionWorkspaceV1Payload,
});

/**
 * The whole of the version difference: one branch becomes a one-element set, and
 * everything downstream — handler, packs, audit trail — sees only the v2 shape.
 */
export function provisionWorkspaceV1ToV2(
  payload: ProvisionWorkspaceV1Payload,
): ProvisionWorkspacePayload {
  const { branch, ...rest } = payload;
  return { ...rest, branches: [branch] };
}

export type ProvisionWorkspacePayload = z.infer<typeof provisionWorkspacePayload>;
export type ProvisionWorkspaceCommand = z.infer<typeof provisionWorkspaceCommand>;
export type ProvisionWorkspaceV1Payload = z.infer<typeof provisionWorkspaceV1Payload>;
export type ProvisionWorkspaceV1Command = z.infer<typeof provisionWorkspaceV1Command>;
