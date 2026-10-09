import { z } from "zod";
import { ROLES } from "../roles.js";
import { historyActor } from "./history.js";

/**
 * One note on a vehicle (`GET /v1/notes/:noteId`, #98): its text, who wrote it
 * in which role, and, for a note from Direction, who said they saw it. A note
 * never changes; `acknowledgement` is a separate append-only record.
 */
export const noteDetail = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  body: z.string(),
  author: historyActor,
  /** The author's role when the note was written. */
  authorRole: z.enum(ROLES),
  createdAt: z.iso.datetime(),
  /** Null until someone acknowledges it; always null on a note not from Direction. */
  acknowledgement: z
    .object({
      by: historyActor,
      at: z.iso.datetime(),
    })
    .nullable(),
});

export type NoteDetail = z.infer<typeof noteDetail>;
