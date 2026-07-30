import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { TEMPLATE_CODES } from "../templates.js";
import { TOGGLEABLE_MODULE_CODES } from "../modules.js";

export const provisionWorkspacePayload = z.strictObject({
  workspace: z.strictObject({
    id: z.uuid(),
    slug: z.string().min(1).max(80).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphens"),
    name: z.string().min(1),
    defaultCurrency: z.enum(["XAF"]).optional().default("XAF"),
    timezone: z.string().optional().default("Africa/Douala"),
    defaultLocale: z.string().optional().default("fr-CM"),
  }),
  branch: z.strictObject({
    id: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
  }),
  admin: z.strictObject({
    id: z.uuid(),
    displayName: z.string().min(1),
    username: z.string().min(1).max(80),
    pin: z.string().min(4).max(64),
  }),
  enabledPresets: z.array(z.enum(TEMPLATE_CODES)).min(1, "At least one preset must be enabled"),
  disabledModules: z.array(z.enum(TOGGLEABLE_MODULE_CODES)).default([]),
});

export const provisionWorkspaceCommand = z.object({
  name: z.literal("provision-workspace"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: provisionWorkspacePayload,
});

export type ProvisionWorkspacePayload = z.infer<typeof provisionWorkspacePayload>;
export type ProvisionWorkspaceCommand = z.infer<typeof provisionWorkspaceCommand>;
