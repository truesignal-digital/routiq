import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * "Seen" on a note Direction left on a vehicle (#98). The note itself never
 * changes: the acknowledgement is its own append-only record, naming who saw
 * it and when, and the note leaves the vehicle's To-do. The member is the
 * session's; the payload names only the note.
 */
export const acknowledgeNotePayload = z.strictObject({
  noteId: z.uuid(),
});

export const acknowledgeNoteCommand = z.object({
  name: z.literal("acknowledge-note"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: acknowledgeNotePayload,
});

export type AcknowledgeNotePayload = z.infer<typeof acknowledgeNotePayload>;
export type AcknowledgeNoteCommand = z.infer<typeof acknowledgeNoteCommand>;
