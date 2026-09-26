import { createHash } from "node:crypto";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  preHandlerHookHandler,
} from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { Db } from "../db/client.js";
import { inWorkspace } from "../db/tenant.js";
import type { ObjectStorage } from "../storage/types.js";
import { canReadLedger, FINANCE_READER_ROLES } from "@routiq/contracts";
import { financialEntries, sourceArtifacts } from "../db/schema.js";
import { entryEvidenceFiles, hasPostingWithoutWorkOrder } from "../reads/entry-evidence.js";
import { invalidRequest, notFound, passReadGate, ReadRefusal } from "../reads/read-gate.js";

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

  // GET /v1/artifacts/:id/download-url
  app.get(
    "/v1/artifacts/:id/download-url",
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!req.auth) {
        return reply.status(401).send({ error: { code: "AUTH_REQUIRED" } });
      }
      const auth = req.auth;

      const { id } = req.params as { id: string };

      try {
        const artifact = await inWorkspace(
          db,
          auth.workspaceId,
          async (tx) => {
            const [row] = await tx
              .select()
              .from(sourceArtifacts)
              .where(
                and(
                  eq(sourceArtifacts.id, id),
                  eq(sourceArtifacts.workspaceId, auth.workspaceId),
                ),
              );
            return row;
          },
        );

        if (!artifact) {
          return reply.status(404).send({
            error: { code: "REFERENCE_NOT_FOUND" },
          });
        }

        const presigned = await presignVerifiedArtifact(storage, auth.workspaceId, artifact, req.log);
        if ("integrityMismatch" in presigned) {
          return reply.status(409).send({ error: { code: "ARTIFACT_INTEGRITY_MISMATCH" } });
        }
        return presigned;
      } catch (error) {
        req.log.error({ err: error, event: "download_url.failed", id });
        return reply.status(500).send({
          error: { code: "DOWNLOAD_URL_FAILED" },
        });
      }
    },
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
    async (req, reply) => {
      if (!req.auth) {
        return reply.status(401).send({ error: { code: "AUTH_REQUIRED" } });
      }
      const auth = req.auth;

      try {
        const params = z
          .object({ entryId: z.uuid(), artifactId: z.uuid() })
          .safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { entryId, artifactId } = params.data;

        const artifact = await inWorkspace(db, auth.workspaceId, async (tx) => {
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
        });

        const presigned = await presignVerifiedArtifact(storage, auth.workspaceId, artifact, req.log);
        if ("integrityMismatch" in presigned) {
          return reply.status(409).send({ error: { code: "ARTIFACT_INTEGRITY_MISMATCH" } });
        }
        return presigned;
      } catch (error) {
        if (error instanceof ReadRefusal) {
          return reply.status(error.status).send(error.body());
        }
        req.log.error({ err: error, event: "entry_evidence_download_url.failed" });
        return reply.status(500).send({ error: { code: "DOWNLOAD_URL_FAILED" } });
      }
    },
  );
}
