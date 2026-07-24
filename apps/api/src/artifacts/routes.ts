import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { Db } from "../db/client.js";
import { inWorkspace } from "../db/tenant.js";
import type { ObjectStorage } from "../storage/types.js";
import { sourceArtifacts } from "../db/schema.js";

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

            // Write cleaned bytes back to storage
            await storage.putObject(storageKey, finalBytes, mimeType);
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

        // Step 5: Insert sourceArtifacts row
        try {
          const inserted = await inWorkspace(
            db,
            auth.workspaceId,
            async (tx) => {
              await tx.insert(sourceArtifacts).values({
                id: artifactId,
                workspaceId: auth.workspaceId,
                storageKey,
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

        const url = await storage.presignGet(artifact.storageKey, {
          expiresSeconds: 300,
        });

        return { url };
      } catch (error) {
        req.log.error({ err: error, event: "download_url.failed", id });
        return reply.status(500).send({
          error: { code: "DOWNLOAD_URL_FAILED" },
        });
      }
    },
  );
}
