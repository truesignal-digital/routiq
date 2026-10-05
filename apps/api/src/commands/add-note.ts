import { addNotePayload, type AddNotePayload } from "@routiq/contracts";
import { notes } from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { requireAsset } from "./work-order-lookup.js";

/**
 * A remark on a vehicle (§3.1 Note). Append-only: the row is never edited and
 * the runtime role cannot delete it, so a correction is another note.
 *
 * Every role may write one: a note is a remark, not a decision. A disposed vehicle takes no new operational record
 * (§3.4), and a note is one — `operationalAssetId` makes the dispatcher refuse
 * it with ASSET_NOT_OPERATIONAL.
 */
export const addNote: CommandDefinition<AddNotePayload> = {
  name: "add-note",
  version: 1,
  module: "CORE",
  allowedRoles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
  payloadSchema: addNotePayload,
  operationalAssetId: (payload) => (payload.entityType === "asset" ? payload.entityId : undefined),
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.entityId]),
  },

  async execute(tx, ctx, envelope, payload) {
    const asset = await requireAsset(tx, ctx, payload.entityId);

    await tx.insert(notes).values({
      id: payload.noteId,
      workspaceId: ctx.workspaceId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      assetId: asset.id,
      authorMembershipId: ctx.membershipId,
      body: payload.body,
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "note.added",
      entityType: "note",
      entityId: payload.noteId,
      afterState: {
        entityType: payload.entityType,
        entityId: payload.entityId,
        body: payload.body,
      },
      changedFields: ["entityType", "entityId", "body"],
    });

    return { recordId: payload.noteId, rowVersion: 1 };
  },
};

registerCommand(addNote);
