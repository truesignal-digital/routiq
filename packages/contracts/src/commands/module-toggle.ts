import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { TOGGLEABLE_MODULE_CODES } from "../modules.js";

export const enableModulePayload = z.strictObject({
  moduleCode: z.enum(TOGGLEABLE_MODULE_CODES),
});

export const disableModulePayload = z.strictObject({
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

export type EnableModulePayload = z.infer<typeof enableModulePayload>;
export type DisableModulePayload = z.infer<typeof disableModulePayload>;
export type EnableModuleCommand = z.infer<typeof enableModuleCommand>;
export type DisableModuleCommand = z.infer<typeof disableModuleCommand>;
