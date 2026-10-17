import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { TOGGLEABLE_MODULE_CODES } from "../modules.js";

/**
 * Module flags are entitlements the vendor grants (ADR-0005). v2 is the
 * platform-scope command a vendor operator runs against a named workspace. v1
 * named no workspace because it ran inside the caller's own; it stays
 * registered only so a tenant still sending it gets the platform-scope refusal.
 */
export const enableModulePayload = z.strictObject({
  moduleCode: z.enum(TOGGLEABLE_MODULE_CODES),
});

export const disableModulePayload = z.strictObject({
  moduleCode: z.enum(TOGGLEABLE_MODULE_CODES),
});

export const moduleToggleV2Payload = z.strictObject({
  workspaceSlug: z.string().min(1).max(80),
  moduleCode: z.enum(TOGGLEABLE_MODULE_CODES),
});

export const enableModuleCommand = z.object({
  name: z.literal("enable-module"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: enableModulePayload,
});

export const disableModuleCommand = z.object({
  name: z.literal("disable-module"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: disableModulePayload,
});

export const enableModuleV2Command = z.object({
  name: z.literal("enable-module"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: moduleToggleV2Payload,
});

export const disableModuleV2Command = z.object({
  name: z.literal("disable-module"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: moduleToggleV2Payload,
});

export type EnableModulePayload = z.infer<typeof enableModulePayload>;
export type DisableModulePayload = z.infer<typeof disableModulePayload>;
export type ModuleToggleV2Payload = z.infer<typeof moduleToggleV2Payload>;
export type EnableModuleCommand = z.infer<typeof enableModuleCommand>;
export type DisableModuleCommand = z.infer<typeof disableModuleCommand>;
export type EnableModuleV2Command = z.infer<typeof enableModuleV2Command>;
export type DisableModuleV2Command = z.infer<typeof disableModuleV2Command>;
