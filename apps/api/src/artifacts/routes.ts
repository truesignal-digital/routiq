import { createHash } from "node:crypto";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import { and, eq, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { canReadLedger, FINANCE_READER_ROLES } from "@routiq/contracts";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { inWorkspace, type TenantTx } from "../db/tenant.js";
import type { ObjectStorage } from "../storage/types.js";
import {
  commandSourceArtifacts,
  documents,
  financialEntries,
  operationalIssues,
  sourceArtifacts,
} from "../db/schema.js";
import { requireScopedAsset } from "../reads/asset-scope.js";
import { entryEvidenceFiles, hasPostingWithoutWorkOrder } from "../reads/entry-evidence.js";
import { invalidRequest, notFound, passReadGate, ReadRefusal } from "../reads/read-gate.js";
import { linkedArtifact } from "../reads/record-artifacts.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const presignRequestSchema = z.strictObject({
  artifactId: z.uuid(),
  fileName: z.string().max(200).optional(),
  sizeBytes: z.number().int().positive().max(25_000_000),
});

const finalizeRequestSchema = z.strictObject({
  artifactId: z.uuid(),
  fileName: z.string().max(200).optional(),
});

function getStorageKey(workspaceId: string, artifactId: string): string {
  return `ws/${workspaceId}/artifacts/${artifactId}`;
}

function getFinalStorageKey(workspaceId: string, artifactId: string, sha256: string): string {
  return `ws/${workspaceId}/finalized-artifacts/${artifactId}/${sha256}`;
}

type ArtifactRow = typeof sourceArtifacts.$inferSelect;

/**
 * A short-lived GET URL for a stored artifact, after checking the bytes still
 * hash to what was recorded. Callers decide WHO may have the file; this decides
 * only that what they get is the file that was recorded.
 */
async function presignVerifiedArtifact(
  storage: ObjectStorage,
  workspaceId: string,
  artifact: ArtifactRow,
  log: FastifyBaseLogger,
): Promise<{ url: string } | { integrityMismatch: true }> {
  const finalStorageKey = getFinalStorageKey(workspaceId, artifact.id, artifact.sha256);
  if (artifact.storageKey !== finalStorageKey) {
    // Older rows point at the mutable upload key. Preserve a verified
    // snapshot before issuing a GET URL; do not grant UPDATE on evidence
    // rows or trust a later replacement of the legacy upload object.
    const preserved = await storage.getObject(finalStorageKey);
    const candidate = preserved ?? await storage.getObject(artifact.storageKey);
    if (!candidate || createHash("sha256").update(candidate.body).digest("hex") !== artifact.sha256) {
      log.error({ event: "artifact.integrity_mismatch", artifactId: artifact.id });
      return { integrityMismatch: true };
    }
    if (!preserved) {
      await storage.putObject(finalStorageKey, candidate.body, artifact.mimeType);
    }
  }

  const url = await storage.presignGet(finalStorageKey, {
    expiresSeconds: 300,
  });
  return { url };
}

export function registerArtifactRoutes(
  app: FastifyInstance,
  db: Db,
  storage: ObjectStorage,
  requireAuth: preHandlerHookHandler,
): void {
  // POST /v1/artifacts/presign
  app.post(
    "/v1/artifacts/presign",
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!req.auth) {
        return reply.status(401).send({ error: { code: "AUTH_REQUIRED" } });
      }
      const auth = req.auth;

      const parsed = presignRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_FAILED",
            metadata: {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path,
              })),
            },
          },
        });
      }

      const { artifactId, fileName, sizeBytes } = parsed.data;
      const storageKey = getStorageKey(auth.workspaceId, artifactId);

      try {
        const uploadUrl = await storage.presignPut(storageKey, {
          contentType: "application/octet-stream",
          expiresSeconds: 900,
        });

        return {
          artifactId,
          storageKey,
          uploadUrl,
        };
      } catch (error) {
        req.log.error({ err: error, event: "presign.failed" });
        return reply.status(500).send({ error: { code: "STORAGE_FAILED" } });
      }
    },
  );

  // POST /v1/artifacts/finalize
  app.post(
    "/v1/artifacts/finalize",
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!req.auth) {
        return reply.status(401).send({ error: { code: "AUTH_REQUIRED" } });
      }
      const auth = req.auth;

      const parsed = finalizeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_FAILED",
            metadata: {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path,
              })),
            },
          },
        });
      }

      const { artifactId, fileName } = parsed.data;
      const storageKey = getStorageKey(auth.workspaceId, artifactId);

      try {
        // Step 1: Check if object exists
        const obj = await storage.getObject(storageKey);
        if (!obj) {
          return reply.status(422).send({
            error: { code: "ARTIFACT_UPLOAD_INCOMPLETE" },
          });
        }

        // Step 2: Sniff MIME type
        const detectedType = await fileTypeFromBuffer(obj.body);
        const mimeType = detectedType?.mime;

        if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
          return reply.status(422).send({
            error: {
              code: "UNSUPPORTED_MEDIA_TYPE",
              metadata: { detected: mimeType ?? null },
            },
          });
        }

        // Step 3: Process images (strip EXIF)
        let finalBytes = obj.body;
        if (mimeType.startsWith("image/")) {
          try {
            const image = sharp(obj.body);
            const metadata = await image.metadata();
            const format = metadata.format as
              | "jpeg"
              | "png"
              | "webp"
              | undefined;

            // Rotate first to bake orientation, then convert to buffer without EXIF
            finalBytes = await image
              .rotate()
              .toFormat(format ?? "jpeg")
              .toBuffer();
          } catch (error) {
            req.log.error({
              err: error,
              event: "image.processing.failed",
              artifactId,
            });
            return reply.status(422).send({
              error: { code: "UNSUPPORTED_MEDIA_TYPE", metadata: { reason: "unprocessable_image" } },
            });
          }
        }

        // Step 4: Calculate SHA-256 of final bytes
        const sha256 = createHash("sha256").update(finalBytes).digest("hex");
        // Client PUT URLs address only the upload key. A different finalized
        // payload gets a different key, so a losing concurrent finalize cannot
        // overwrite the winner. Equal hashes only write the same bytes.
        const finalStorageKey = getFinalStorageKey(auth.workspaceId, artifactId, sha256);
        await storage.putObject(finalStorageKey, finalBytes, mimeType);

        // Step 5: Insert sourceArtifacts row
        try {
          const inserted = await inWorkspace(
            db,
            auth.workspaceId,
            async (tx) => {
              await tx.insert(sourceArtifacts).values({
                id: artifactId,
                workspaceId: auth.workspaceId,
                storageKey: finalStorageKey,
                sha256,
                mimeType,
                sizeBytes: BigInt(finalBytes.length),
                originalFileName: fileName ?? null,
                uploadedByPrincipalId: auth.principalId,
              });

              const [row] = await tx
                .select()
                .from(sourceArtifacts)
                .where(
                  and(
                    eq(sourceArtifacts.workspaceId, auth.workspaceId),
                    eq(sourceArtifacts.id, artifactId),
                  ),
                );
              return row;
            },
          );

          if (!inserted) {
            return reply.status(500).send({
              error: { code: "STORAGE_FAILED" },
            });
          }

          return {
            id: inserted.id,
            workspaceId: inserted.workspaceId,
            storageKey: inserted.storageKey,
            sha256: inserted.sha256,
            mimeType: inserted.mimeType,
            sizeBytes: Number(inserted.sizeBytes),
            originalFileName: inserted.originalFileName,
            uploadedByPrincipalId: inserted.uploadedByPrincipalId,
            createdAt: inserted.createdAt,
          };
        } catch (error) {
          // Check for unique constraint violation (duplicate artifactId)
          if (
            error instanceof Error &&
            "cause" in error &&
            error.cause instanceof Error &&
            "code" in error.cause &&
            error.cause.code === "23505"
          ) {
            return reply.status(409).send({
              error: { code: "UNIQUE_CONSTRAINT_VIOLATION" },
            });
          }
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "23505"
          ) {
            return reply.status(409).send({
              error: { code: "UNIQUE_CONSTRAINT_VIOLATION" },
            });
          }
          req.log.error({ err: error, event: "finalize.failed", artifactId });
          return reply.status(500).send({
            error: { code: "STORAGE_FAILED" },
          });
        }
      } catch (error) {
        req.log.error({ err: error, event: "finalize.failed", artifactId });
        return reply.status(500).send({ error: { code: "STORAGE_FAILED" } });
      }
    },
  );

  /**
   * Serves a stored file once `locate`, run inside the caller's workspace, has
   * authorized the record it hangs off and returned the file's row. Every
   * refusal is thrown from `locate`, so none of them ever reaches storage.
   */
  async function sendDownloadUrl(
    req: FastifyRequest,
    reply: FastifyReply,
    event: string,
    locate: (tx: TenantTx, auth: AuthContext) => Promise<ArtifactRow>,
  ) {
    if (!req.auth) {
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED" } });
    }
    const auth = req.auth;
    try {
      const artifact = await inWorkspace(db, auth.workspaceId, (tx) => locate(tx, auth));
      const presigned = await presignVerifiedArtifact(storage, auth.workspaceId, artifact, req.log);
      if ("integrityMismatch" in presigned) {
        return reply.status(409).send({ error: { code: "ARTIFACT_INTEGRITY_MISMATCH" } });
      }
      return presigned;
    } catch (error) {
      if (error instanceof ReadRefusal) {
        return reply.status(error.status).send(error.body());
      }
      req.log.error({ err: error, event });
      return reply.status(500).send({ error: { code: "DOWNLOAD_URL_FAILED" } });
    }
  }

  /**
   * The caller's own upload, before any command links it — the preview of a
   * file still being attached. Once a command links a file it belongs to that
   * record and downloads only through the record's route, which checks who may
   * read the record (review P1). Anything else is the same 404.
   */
  app.get(
    "/v1/artifacts/:id/download-url",
    { preHandler: requireAuth },
    async (req, reply) =>
      sendDownloadUrl(req, reply, "download_url.failed", async (tx, auth) => {
        const params = z.object({ id: z.uuid() }).safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { id } = params.data;
        const [row] = await tx
          .select()
          .from(sourceArtifacts)
          .where(
            and(
              eq(sourceArtifacts.workspaceId, auth.workspaceId),
              eq(sourceArtifacts.id, id),
              eq(sourceArtifacts.uploadedByPrincipalId, auth.principalId),
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(commandSourceArtifacts)
                  .where(
                    and(
                      eq(commandSourceArtifacts.workspaceId, auth.workspaceId),
                      eq(commandSourceArtifacts.artifactId, id),
                    ),
                  ),
              ),
            ),
          )
          .limit(1);
        if (!row) throw notFound();
        return row;
      }),
  );

  /**
   * A scan of a vehicle document, for a caller who may read the vehicle's
   * documents: the DOCUMENTS module, the vehicle in the caller's branches, the
   * document on that vehicle, the file linked by the command that recorded it.
   */
  app.get(
    "/v1/assets/:assetId/documents/:documentId/artifacts/:artifactId/download-url",
    { preHandler: requireAuth },
    async (req, reply) =>
      sendDownloadUrl(req, reply, "document_download_url.failed", async (tx, auth) => {
        const params = z
          .object({ assetId: z.uuid(), documentId: z.uuid(), artifactId: z.uuid() })
          .safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { assetId, documentId, artifactId } = params.data;
        await passReadGate(tx, auth, { module: "DOCUMENTS" });
        await requireScopedAsset(tx, auth, assetId);
        const [document] = await tx
          .select({ createdByCommandId: documents.createdByCommandId })
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, auth.workspaceId),
              eq(documents.id, documentId),
              eq(documents.assetId, assetId),
            ),
          )
          .limit(1);
        if (!document) throw notFound();
        return linkedArtifact(tx, auth.workspaceId, document.createdByCommandId, artifactId);
      }),
  );

  /**
   * A photo taken with a signalement, for a caller who may read the issue: the
   * MAINTENANCE module, the issue's vehicle in the caller's branches, the file
   * linked by the report-issue call that recorded it.
   */
  app.get(
    "/v1/issues/:issueId/artifacts/:artifactId/download-url",
    { preHandler: requireAuth },
    async (req, reply) =>
      sendDownloadUrl(req, reply, "issue_download_url.failed", async (tx, auth) => {
        const params = z
          .object({ issueId: z.uuid(), artifactId: z.uuid() })
          .safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { issueId, artifactId } = params.data;
        await passReadGate(tx, auth, { module: "MAINTENANCE" });
        const [issue] = await tx
          .select({
            assetId: operationalIssues.assetId,
            createdByCommandId: operationalIssues.createdByCommandId,
          })
          .from(operationalIssues)
          .where(
            and(
              eq(operationalIssues.workspaceId, auth.workspaceId),
              eq(operationalIssues.id, issueId),
            ),
          )
          .limit(1);
        if (!issue) throw notFound();
        await requireScopedAsset(tx, auth, issue.assetId);
        return linkedArtifact(tx, auth.workspaceId, issue.createdByCommandId, artifactId);
      }),
  );

  /**
   * A file behind a financial entry, for a caller who may read that entry. The
   * workspace-wide route above answers any member of the tenant; an entry is a
   * financial record read against the caller's branches, so its receipt must be
   * too — this route is the only one the finance screens use (PLAN §1.7).
   * Checked in order: the FINANCE module and a ledger-reading role, the entry in
   * the caller's branches, the file among the entry's evidence; each miss past
   * the role is the same 404, and storage is never touched before all pass.
   * The workshop, outside the ledger readers, reaches only entries whose every
   * line is a work-order cost — the rule attach-evidence applies to it.
   */
  app.get(
    "/v1/finance/entries/:entryId/evidence/:artifactId/download-url",
    { preHandler: requireAuth },
    async (req, reply) =>
      sendDownloadUrl(req, reply, "entry_evidence_download_url.failed", async (tx, auth) => {
        const params = z
          .object({ entryId: z.uuid(), artifactId: z.uuid() })
          .safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { entryId, artifactId } = params.data;

        await passReadGate(tx, auth, {
          module: "FINANCE",
          roles: [...FINANCE_READER_ROLES, "MAINTENANCE"],
        });
        const [entry] = await tx
          .select({
            id: financialEntries.id,
            branchId: financialEntries.branchId,
            createdByCommandId: financialEntries.createdByCommandId,
          })
          .from(financialEntries)
          .where(
            and(
              eq(financialEntries.workspaceId, auth.workspaceId),
              eq(financialEntries.id, entryId),
            ),
          )
          .limit(1);
        if (
          !entry ||
          (auth.branchScope !== "ALL" && !auth.branchScope.includes(entry.branchId))
        ) {
          throw notFound();
        }
        if (
          !canReadLedger(auth.role) &&
          (await hasPostingWithoutWorkOrder(tx, auth.workspaceId, entry.id))
        ) {
          throw notFound();
        }

        const files = await entryEvidenceFiles(tx, auth.workspaceId, entry);
        if (!files.some((file) => file.artifactId === artifactId)) throw notFound();

        const [row] = await tx
          .select()
          .from(sourceArtifacts)
          .where(
            and(
              eq(sourceArtifacts.workspaceId, auth.workspaceId),
              eq(sourceArtifacts.id, artifactId),
            ),
          )
          .limit(1);
        if (!row) throw notFound();
        return row;
      }),
  );
}
