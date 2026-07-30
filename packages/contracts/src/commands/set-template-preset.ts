import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { TEMPLATE_CODES } from "../templates.js";

export const setTemplatePresetPayload = z.strictObject({
  presetCode: z.enum(TEMPLATE_CODES),
  enabled: z.boolean(),
});

export const setTemplatePresetCommand = z.object({
  name: z.literal("set-template-preset"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: setTemplatePresetPayload,
});

export type SetTemplatePresetPayload = z.infer<typeof setTemplatePresetPayload>;
export type SetTemplatePresetCommand = z.infer<typeof setTemplatePresetCommand>;
