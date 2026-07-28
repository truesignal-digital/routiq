import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Closing is a decision, not a captured fact: §6 lists activity close among the
 * things that always need a server round trip, so this never queues offline.
 * `expectedVersion` refers to the activity.
 */
export const closeActivityPayload = z.object({
  activityId: z.uuid(),
  /** Required when the activity has no actual end yet — one of the two hard blocks. */
  endedAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().max(500).optional(),
});

export const closeActivityCommand = z.object({
  name: z.literal("close-activity"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: closeActivityPayload,
});

/** §5.1: one approval. Realized as a restricted role plus a mandatory reason. */
export const reopenActivityPayload = z.object({
  activityId: z.uuid(),
  reason: z.string().min(1).max(300),
});

export const reopenActivityCommand = z.object({
  name: z.literal("reopen-activity"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reopenActivityPayload,
});

export type CloseActivityCommand = z.infer<typeof closeActivityCommand>;
export type ReopenActivityCommand = z.infer<typeof reopenActivityCommand>;
