import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

export const approveEntryPayload = z.object({
  entryId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});

export const rejectEntryPayload = z.object({
  entryId: z.uuid(),
  reason: z.string().min(1).max(500),
});

export const approveEntryCommand = z.object({
  name: z.literal("approve-entry"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: approveEntryPayload,
});

export const rejectEntryCommand = z.object({
  name: z.literal("reject-entry"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: rejectEntryPayload,
});

export type ApproveEntryCommand = z.infer<typeof approveEntryCommand>;
export type RejectEntryCommand = z.infer<typeof rejectEntryCommand>;
