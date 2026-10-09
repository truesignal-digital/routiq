import { acknowledgeNotePayload, type AcknowledgeNotePayload } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { noteAcknowledgements, notes } from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  appendNoChangeAuditEvent,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";

async function noteAssetBranchIds(
  tx: Tx,
  ctx: CommandContext,
  payload: AcknowledgeNotePayload,
): Promise<readonly string[]> {
  const [note] = await tx
    .select({ assetId: notes.assetId })
    .from(notes)
    .where(and(eq(notes.workspaceId, ctx.workspaceId), eq(notes.id, payload.noteId)))
    .limit(1);
  // A missing note resolves to no branch, so the handler reports it with its id.
  return note?.assetId ? assetBranchIds(tx, ctx, [note.assetId]) : [];
}

/**
 * "Seen" on a note from Direction (#98). The note never changes: the
 * acknowledgement is its own append-only row, plus a `note.acknowledged` event
 * on the note's trail, so the note's history says who saw it and when.
 *
 * Anyone who can see the vehicle may acknowledge it, except its author: the
 * note waits for the team. One acknowledgement per note; a second one, from
 * another member or another tab, succeeds without adding a row.
 */
export const acknowledgeNote: CommandDefinition<AcknowledgeNotePayload> = {
  name: "acknowledge-note",
  version: 1,
  module: "CORE",
  allowedRoles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
  payloadSchema: acknowledgeNotePayload,
  branchAuthorization: { kind: "branches", resolve: noteAssetBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const [note] = await tx
      .select({
        id: notes.id,
        authorRole: notes.authorRole,
        authorMembershipId: notes.authorMembershipId,
      })
      .from(notes)
      .where(and(eq(notes.workspaceId, ctx.workspaceId), eq(notes.id, payload.noteId)))
      .limit(1);
    if (!note) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "note",
        referenceId: payload.noteId,
      });
    }
    if (note.authorRole !== "DIRECTOR") {
      throw new CommandError(409, "NOTE_NOT_FROM_DIRECTION", { noteId: note.id });
    }
    if (note.authorMembershipId === ctx.membershipId) {
      throw new CommandError(403, "NOTE_AUTHOR_CANNOT_ACKNOWLEDGE", { noteId: note.id });
    }

    const [row] = await tx
      .insert(noteAcknowledgements)
      .values({
        workspaceId: ctx.workspaceId,
        noteId: note.id,
        membershipId: ctx.membershipId,
        createdByCommandId: envelope.commandId,
      })
      .onConflictDoNothing()
      .returning({ id: noteAcknowledgements.id });
    if (!row) {
      const [existing] = await tx
        .select({ id: noteAcknowledgements.id })
        .from(noteAcknowledgements)
        .where(
          and(
            eq(noteAcknowledgements.workspaceId, ctx.workspaceId),
            eq(noteAcknowledgements.noteId, note.id),
          ),
        );
      if (!existing) throw new Error("note_acknowledgements conflict without a row");
      await appendNoChangeAuditEvent(tx, ctx, envelope, {
        noteId: note.id,
        acknowledgementId: existing.id,
      });
      return { recordId: existing.id, rowVersion: 1 };
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "note.acknowledged",
      entityType: "note",
      entityId: note.id,
      afterState: { acknowledgementId: row.id, membershipId: ctx.membershipId },
      changedFields: ["acknowledged"],
    });

    return { recordId: row.id, rowVersion: 1 };
  },
};

registerCommand(acknowledgeNote);
