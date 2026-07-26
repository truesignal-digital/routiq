import { addOrRenewDocumentPayload } from "@routiq/contracts";
import type { z } from "zod";
import { and, eq } from "drizzle-orm";
import { assets, categories, documents } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { assetBranchIds } from "./branch-authorization.js";

type AddOrRenewDocumentPayload = z.infer<typeof addOrRenewDocumentPayload>;

const addOrRenewDocument: CommandDefinition<AddOrRenewDocumentPayload> = {
  name: "add-or-renew-document",
  version: 1,
  module: "DOCUMENTS",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"],
  payloadSchema: addOrRenewDocumentPayload,
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) =>
      assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async execute(tx, ctx, envelope, payload) {
    // Verify asset exists in workspace
    const asset = await tx.query.assets.findFirst({
      where: and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, payload.assetId),
      ),
    });

    if (!asset) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "asset",
      });
    }

    // Verify documentTypeCode exists in active categories
    const documentType = await tx.query.categories.findFirst({
      where: and(
        eq(categories.workspaceId, ctx.workspaceId),
        eq(categories.kind, "DOCUMENT_TYPE"),
        eq(categories.code, payload.documentTypeCode),
        eq(categories.active, true),
      ),
    });

    if (!documentType) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "documentType",
      });
    }

    // If renewing, verify the superseded document
    if (payload.supersedesDocumentId) {
      const supersededDoc = await tx.query.documents.findFirst({
        where: and(
          eq(documents.workspaceId, ctx.workspaceId),
          eq(documents.id, payload.supersedesDocumentId),
        ),
      });

      if (!supersededDoc) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "supersededDocument",
        });
      }

      if (supersededDoc.assetId !== payload.assetId) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "supersededDocument",
        });
      }

      if (supersededDoc.documentTypeCode !== payload.documentTypeCode) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "supersededDocument",
        });
      }
    }

    // Insert the document row
    try {
      await tx.insert(documents).values({
        id: payload.documentId,
        workspaceId: ctx.workspaceId,
        assetId: payload.assetId,
        documentTypeCode: payload.documentTypeCode,
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.documentNumber === undefined ? {} : { documentNumber: payload.documentNumber }),
        ...(payload.issuedAt === undefined ? {} : { issuedAt: payload.issuedAt }),
        ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
        ...(payload.supersedesDocumentId === undefined ? {} : { supersedesDocumentId: payload.supersedesDocumentId }),
        createdByCommandId: envelope.commandId,
      });
    } catch (error) {
      // Check for unique constraint violation on documents_supersedes_uq
      if (
        error !== null &&
        typeof error === "object" &&
        "cause" in error
      ) {
        const cause = (error as { cause: unknown }).cause;
        if (
          cause !== null &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "23505" &&
          "constraint" in cause &&
          cause.constraint === "documents_supersedes_uq"
        ) {
          throw new CommandError(409, "DOCUMENT_ALREADY_SUPERSEDED", {
            supersedesDocumentId: payload.supersedesDocumentId,
          });
        }
      }
      throw error;
    }

    // Audit event
    const eventType = payload.supersedesDocumentId ? "document.renewed" : "document.added";
    await appendAuditEvent(tx, ctx, envelope, {
      eventType,
      entityType: "document",
      entityId: payload.documentId,
      afterState: {
        id: payload.documentId,
        workspaceId: ctx.workspaceId,
        assetId: payload.assetId,
        documentTypeCode: payload.documentTypeCode,
        title: payload.title ?? null,
        documentNumber: payload.documentNumber ?? null,
        issuedAt: payload.issuedAt ?? null,
        expiresAt: payload.expiresAt ?? null,
        supersedesDocumentId: payload.supersedesDocumentId ?? null,
        createdByCommandId: envelope.commandId,
      },
      changedFields: [
        "id",
        "workspaceId",
        "assetId",
        "documentTypeCode",
        "title",
        "documentNumber",
        "issuedAt",
        "expiresAt",
        "supersedesDocumentId",
        "createdByCommandId",
      ],
    });

    return { recordId: payload.documentId, rowVersion: 1 };
  },
};

registerCommand(addOrRenewDocument);
