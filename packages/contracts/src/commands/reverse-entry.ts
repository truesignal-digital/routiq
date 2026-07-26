import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

export const reverseEntryPayload = z.object({
  reversalEntryId: z.uuid(),
  originalEntryId: z.uuid(),
  reason: z.string().min(1).max(500),
});

export const reverseEntryCommand = z.object({
  name: z.literal("reverse-entry"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reverseEntryPayload,
});

export type ReverseEntryCommand = z.infer<typeof reverseEntryCommand>;
