import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { TEMPLATE_CODES } from "../templates.js";

/**
 * Presets are vendor-set like modules (ADR-0005). v2 is the platform-scope
 * command naming the workspace it changes. v1 ran inside the caller's own
 * workspace; it stays registered only so a tenant still sending it gets the
 * platform-scope refusal.
 */
export const setTemplatePresetPayload = z.strictObject({
  presetCode: z.enum(TEMPLATE_CODES),
  enabled: z.boolean(),
});

export const setTemplatePresetV2Payload = z.strictObject({
  workspaceSlug: z.string().min(1).max(80),
  presetCode: z.enum(TEMPLATE_CODES),
  enabled: z.boolean(),
});

export const setTemplatePresetCommand = z.object({
  name: z.literal("set-template-preset"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: setTemplatePresetPayload,
});

export const setTemplatePresetV2Command = z.object({
  name: z.literal("set-template-preset"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: setTemplatePresetV2Payload,
});

export type SetTemplatePresetPayload = z.infer<typeof setTemplatePresetPayload>;
export type SetTemplatePresetV2Payload = z.infer<typeof setTemplatePresetV2Payload>;
export type SetTemplatePresetCommand = z.infer<typeof setTemplatePresetCommand>;
export type SetTemplatePresetV2Command = z.infer<typeof setTemplatePresetV2Command>;
