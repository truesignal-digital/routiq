import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { assetDocumentsReadResponse } from "@routiq/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { ANY_ROLE, defineRead } from "./define-read.js";
import { assets, categories, documents } from "../db/schema.js";

/** Documents of one asset, with type labels and the superseding back-link. */
export function registerDocumentReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/assets/:assetId/documents", module: "DOCUMENTS", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedParams = z.object({ assetId: z.uuid() }).safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { assetId } = parsedParams.data;

        const result = await read(async (tx) => {
          const [asset] = await tx
            .select({ id: assets.id, branchId: assets.branchId })
            .from(assets)
            .where(and(eq(assets.workspaceId, auth.workspaceId), eq(assets.id, assetId)));
          if (
            !asset ||
            (auth.branchScope !== "ALL" && !auth.branchScope.includes(asset.branchId))
          ) {
            return undefined;
          }

          const superseding = alias(documents, "superseding");
          const rows = await tx
            .select({
              id: documents.id,
              documentTypeCode: documents.documentTypeCode,
              typeLabelFr: categories.labelFr,
              typeLabelEn: categories.labelEn,
              title: documents.title,
              documentNumber: documents.documentNumber,
              issuedAt: documents.issuedAt,
              expiresAt: documents.expiresAt,
              supersedesDocumentId: documents.supersedesDocumentId,
              supersededByDocumentId: superseding.id,
              createdAt: documents.createdAt,
            })
            .from(documents)
            .leftJoin(
              superseding,
              and(
                eq(superseding.workspaceId, documents.workspaceId),
                eq(superseding.supersedesDocumentId, documents.id),
              ),
            )
            .leftJoin(
              categories,
              and(
                eq(categories.workspaceId, documents.workspaceId),
                eq(categories.kind, "DOCUMENT_TYPE"),
                eq(categories.code, documents.documentTypeCode),
              ),
            )
            .where(
              and(
                eq(documents.workspaceId, auth.workspaceId),
                eq(documents.assetId, assetId),
              ),
            )
            .orderBy(asc(documents.documentTypeCode), asc(documents.createdAt));
          return { rows };
        });
        if (!result) {
          return reply.status(404).send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }
        const { rows } = result;

        return assetDocumentsReadResponse.parse({
          assetId,
          documents: rows.map((row) => ({
            id: row.id,
            type: {
              code: row.documentTypeCode,
              labelFr: row.typeLabelFr ?? row.documentTypeCode,
              labelEn: row.typeLabelEn ?? row.documentTypeCode,
            },
            title: row.title,
            documentNumber: row.documentNumber,
            issuedAt: row.issuedAt,
            expiresAt: row.expiresAt,
            supersedesDocumentId: row.supersedesDocumentId,
            supersededByDocumentId: row.supersededByDocumentId,
            createdAt: row.createdAt.toISOString(),
          })),
        });
      } catch (error) {
        req.log.error({ err: error }, "asset documents read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
