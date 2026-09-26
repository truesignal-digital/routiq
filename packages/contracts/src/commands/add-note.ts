import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * What a note may annotate. v1 notes vehicles only; each new target is a new
 * nullable FK column on `notes` (an exclusive arc), so the tenant FK stays
 * structural rather than trusting a polymorphic id.
 */
export const NOTE_ENTITY_TYPES = ["asset"] as const;
export const noteEntityType = z.enum(NOTE_ENTITY_TYPES);

export const NOTE_BODY_MAX = 2000;

/**
 * A free-text annotation, append-only: never edited, never deleted — a
 * correction is another note. The body is trimmed, so whitespace alone is empty.
 */
export const addNotePayload = z.strictObject({
  noteId: z.uuid(),
  entityType: noteEntityType,
  entityId: z.uuid(),
  body: z.string().trim().min(1).max(NOTE_BODY_MAX),
});

export const addNoteCommand = z.object({
  name: z.literal("add-note"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: addNotePayload,
});

export type NoteEntityType = z.infer<typeof noteEntityType>;
export type AddNotePayload = z.infer<typeof addNotePayload>;
export type AddNoteCommand = z.infer<typeof addNoteCommand>;
