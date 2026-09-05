import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import sharp from "sharp";
import { inject } from "vitest";
import * as schema from "../db/schema.js";
import { buildServer } from "../server.js";
import { createS3Storage } from "../storage/s3.js";
import { seedWorkspace, seedMember } from "../test/seed.js";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import type { ObjectStorage } from "../storage/types.js";

describe(
  "Artifacts API (with MinIO)",
  () => {
    let minio: StartedTestContainer;
    let minioEndpoint: string;
    let pool: pg.Pool;
    let runtimePool: pg.Pool;
    let db: Db;
    let app: Awaited<ReturnType<typeof buildServer>>;
    let workspace: Awaited<ReturnType<typeof seedWorkspace>>["workspace"];
    let principal: Awaited<ReturnType<typeof seedMember>>["principal"];
    let token: string;
    let storage: ObjectStorage;

    beforeAll(async () => {
      minio = await new GenericContainer("minio/minio")
        .withCommand(["server", "/data"])
        .withEnvironment({ MINIO_ROOT_USER: "minioadmin", MINIO_ROOT_PASSWORD: "minioadmin" })
        .withExposedPorts(9000)
        .start();
      minioEndpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

      const s3Client = new S3Client({
        region: "us-east-1",
        endpoint: minioEndpoint,
        credentials: {
          accessKeyId: "minioadmin",
          secretAccessKey: "minioadmin",
        },
        forcePathStyle: true,
      });

      try {
        await s3Client.send(
          new CreateBucketCommand({ Bucket: "artifacts" }),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          !error.message.includes("BucketAlreadyOwnedByYou")
        ) {
          throw error;
        }
      }

      // Set up database and app
      pool = new pg.Pool({ connectionString: inject("databaseUrl") });
      const dbWithSchema = drizzle(pool, { schema });
      db = dbWithSchema as unknown as Db;
      const runtimeUrl = new URL(inject("databaseUrl"));
      runtimeUrl.username = "routiq_app";
      runtimeUrl.password = "routiq_app";
      runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString() });
      const runtimeDb = drizzle(runtimePool, { schema }) as unknown as Db;

      // Seed workspace and member
      const seeded = await seedWorkspace(db);
      workspace = seeded.workspace;

      const member = await seedMember(db, {
        workspaceId: workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      principal = member.principal;

      const session = await createSession(db, {
        principalId: principal.id,
        workspaceId: workspace.id,
      });
      token = session.token;

      // Build app with S3 storage
      storage = createS3Storage({
        endpoint: minioEndpoint,
        region: "us-east-1",
        bucket: "artifacts",
        accessKeyId: "minioadmin",
        secretAccessKey: "minioadmin",
        forcePathStyle: true,
      });
      app = buildServer({
        db: runtimeDb,
        authDb: db,
        storage,
        logger: false,
      });
      await app.ready();
    }, 120000);

    afterAll(async () => {
      await app.close();
      await runtimePool.end();
      await pool.end();
      await minio.stop();
    });

    describe("Presign and Upload", () => {
      it("presign returns upload URL with correct structure", async () => {
        const artifactId = randomUUID();

        const presignRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: {
            artifactId,
            fileName: "test.jpg",
            sizeBytes: 1024,
          },
          headers: { authorization: `Bearer ${token}` },
        });

        expect(presignRes.statusCode).toBe(200);
        const body = JSON.parse(presignRes.body);
        expect(body.artifactId).toBe(artifactId);
        expect(body.storageKey).toContain(workspace.id);
        expect(body.storageKey).toContain(artifactId);
        expect(body.uploadUrl).toContain("http");
      });
    });

    describe("Finalize: Happy Path", () => {
      it("keeps the finalized image and its hash when a different image is uploaded under the same ID", async () => {
        const artifactId = randomUUID();
        const original = await sharp({ create: {
          width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 },
        } }).withExif({ IFD0: { Artist: "Receipt fixture" } }).png().toBuffer();
        expect((await sharp(original).metadata()).exif).toBeDefined();
        const replacement = await sharp({ create: {
          width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 255 },
        } }).png().toBuffer();
        const headers = { authorization: `Bearer ${token}` };
        const upload = async (bytes: Buffer) => {
          const presign = await app.inject({
            method: "POST", url: "/v1/artifacts/presign",
            payload: { artifactId, sizeBytes: bytes.length }, headers,
          });
          expect(presign.statusCode).toBe(200);
          expect((await fetch(presign.json().uploadUrl, { method: "PUT", body: new Uint8Array(bytes) })).ok).toBe(true);
        };
        const finalize = () => app.inject({
          method: "POST", url: "/v1/artifacts/finalize", payload: { artifactId }, headers,
        });
        const download = async () => {
          const response = await app.inject({ method: "GET", url: `/v1/artifacts/${artifactId}/download-url`, headers });
          expect(response.statusCode).toBe(200);
          const object = await fetch(response.json().url);
          expect(object.ok).toBe(true);
          return Buffer.from(await object.arrayBuffer());
        };

        await upload(original);
        const finalized = await finalize();
        expect(finalized.statusCode).toBe(200);
        const before = await download();
        expect((await sharp(before).metadata()).exif).toBeUndefined();
        await upload(replacement);
        expect((await finalize()).statusCode).toBe(409);
        const after = await download();
        expect(after).toEqual(before);
        expect(createHash("sha256").update(after).digest("hex")).toBe(finalized.json().sha256);
      });

      it("returns one winning receipt when finalizations race", async () => {
        const artifactId = randomUUID();
        const original = Buffer.from("%PDF-1.4\nConcurrent receipt: 1000 XAF\n%%EOF");
        const headers = { authorization: `Bearer ${token}` };
        const presign = await app.inject({
          method: "POST", url: "/v1/artifacts/presign",
          payload: { artifactId, sizeBytes: original.length }, headers,
        });
        expect(presign.statusCode).toBe(200);
        expect((await fetch(presign.json().uploadUrl, { method: "PUT", body: original })).ok).toBe(true);
        const results = await Promise.all(Array.from({ length: 5 }, () => app.inject({
          method: "POST", url: "/v1/artifacts/finalize", payload: { artifactId }, headers,
        })));
        expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409, 409, 409, 409]);
        const winner = results.find((response) => response.statusCode === 200)!;
        const download = await app.inject({ method: "GET", url: `/v1/artifacts/${artifactId}/download-url`, headers });
        expect(download.statusCode).toBe(200);
        const object = await fetch(download.json().url);
        expect(object.ok).toBe(true);
        const bytes = Buffer.from(await object.arrayBuffer());
        expect(bytes).toEqual(original);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(winner.json().sha256);
      });

      it("keeps a finalized receipt unchanged when its upload URL is reused", async () => {
        const artifactId = randomUUID();
        const original = Buffer.from("%PDF-1.4\nReceipt: 1000 XAF\n%%EOF");
        const replacement = Buffer.from("%PDF-1.4\nReceipt: 900000 XAF\n%%EOF");
        const headers = { authorization: `Bearer ${token}` };
        const presign = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: { artifactId, sizeBytes: original.length },
          headers,
        });
        expect(presign.statusCode).toBe(200);
        const { uploadUrl } = presign.json();
        expect((await fetch(uploadUrl, { method: "PUT", body: original })).ok).toBe(true);
        const finalized = await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers,
        });
        expect(finalized.statusCode).toBe(200);

        expect((await fetch(uploadUrl, { method: "PUT", body: replacement })).ok).toBe(true);
        const repeated = await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers,
        });
        expect(repeated.statusCode).toBe(409);
        const download = await app.inject({
          method: "GET",
          url: `/v1/artifacts/${artifactId}/download-url`,
          headers,
        });
        expect(download.statusCode).toBe(200);
        const response = await fetch(download.json().url);
        expect(response.ok).toBe(true);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes).toEqual(original);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(finalized.json().sha256);
      });

      it("presign + upload + finalize with JPEG → success with EXIF stripped", async () => {
        const artifactId = randomUUID();

        // Create a minimal JPEG
        const jpegBuffer = await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
          },
        })
          .jpeg()
          .toBuffer();

        // Presign
        const presignRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: {
            artifactId,
            fileName: "photo.jpg",
            sizeBytes: jpegBuffer.length,
          },
          headers: { authorization: `Bearer ${token}` },
        });

        expect(presignRes.statusCode).toBe(200);
        const presignBody = JSON.parse(presignRes.body);

        // Upload to presigned URL
        const uploadRes = await fetch(presignBody.uploadUrl, {
          method: "PUT",
          body: jpegBuffer,
          headers: { "Content-Type": "image/jpeg" },
        });
        expect(uploadRes.ok).toBe(true);

        // Finalize
        const finalizeRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId, fileName: "photo.jpg" },
          headers: { authorization: `Bearer ${token}` },
        });

        expect(finalizeRes.statusCode).toBe(200);
        const finalizeBody = JSON.parse(finalizeRes.body);
        expect(finalizeBody.id).toBe(artifactId);
        expect(finalizeBody.mimeType).toBe("image/jpeg");
        expect(finalizeBody.sha256).toBeDefined();
        expect(typeof finalizeBody.sizeBytes).toBe("number");
        expect(finalizeBody.uploadedByPrincipalId).toBe(principal.id);

        // Verify EXIF was stripped by downloading and checking metadata
        const downloadRes = await app.inject({
          method: "GET",
          url: `/v1/artifacts/${artifactId}/download-url`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(downloadRes.statusCode).toBe(200);
        const downloadBody = JSON.parse(downloadRes.body);
        const fetchRes = await fetch(downloadBody.url);
        const storedBytes = await fetchRes.arrayBuffer();
        const metadata = await sharp(storedBytes).metadata();
        expect(metadata.exif).toBeUndefined();
      });

      it("finalize without upload returns 422 ARTIFACT_UPLOAD_INCOMPLETE", async () => {
        const artifactId = randomUUID();

        // Skip presign/upload, go straight to finalize
        const finalizeRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers: { authorization: `Bearer ${token}` },
        });

        expect(finalizeRes.statusCode).toBe(422);
        const body = JSON.parse(finalizeRes.body);
        expect(body.error.code).toBe("ARTIFACT_UPLOAD_INCOMPLETE");
      });

      it("upload text file → finalize returns 422 UNSUPPORTED_MEDIA_TYPE", async () => {
        const artifactId = randomUUID();
        const textBuffer = Buffer.from("hello world");

        // Presign
        const presignRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: {
            artifactId,
            fileName: "test.txt",
            sizeBytes: textBuffer.length,
          },
          headers: { authorization: `Bearer ${token}` },
        });

        const presignBody = JSON.parse(presignRes.body);

        // Upload text as-is
        await fetch(presignBody.uploadUrl, {
          method: "PUT",
          body: textBuffer,
          headers: { "Content-Type": "text/plain" },
        });

        // Finalize should reject
        const finalizeRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers: { authorization: `Bearer ${token}` },
        });

        expect(finalizeRes.statusCode).toBe(422);
        const body = JSON.parse(finalizeRes.body);
        expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
        expect(body.error.metadata.detected).toBeDefined();
      });

      it("finalize same artifactId twice returns 409 UNIQUE_CONSTRAINT_VIOLATION", async () => {
        const artifactId = randomUUID();
        const jpegBuffer = await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: 0, g: 255, b: 0 },
          },
        })
          .jpeg()
          .toBuffer();

        // First presign + upload + finalize
        const presignRes1 = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: {
            artifactId,
            fileName: "test.jpg",
            sizeBytes: jpegBuffer.length,
          },
          headers: { authorization: `Bearer ${token}` },
        });

        const presignBody1 = JSON.parse(presignRes1.body);
        await fetch(presignBody1.uploadUrl, {
          method: "PUT",
          body: jpegBuffer,
          headers: { "Content-Type": "image/jpeg" },
        });

        const finalizeRes1 = await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers: { authorization: `Bearer ${token}` },
        });
        expect(finalizeRes1.statusCode).toBe(200);

        // Try to finalize same artifactId again with new upload
        const presignRes2 = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: {
            artifactId,
            fileName: "test2.jpg",
            sizeBytes: jpegBuffer.length,
          },
          headers: { authorization: `Bearer ${token}` },
        });

        const presignBody2 = JSON.parse(presignRes2.body);
        await fetch(presignBody2.uploadUrl, {
          method: "PUT",
          body: jpegBuffer,
          headers: { "Content-Type": "image/jpeg" },
        });

        const finalizeRes2 = await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers: { authorization: `Bearer ${token}` },
        });
        expect(finalizeRes2.statusCode).toBe(409);
        const body = JSON.parse(finalizeRes2.body);
        expect(body.error.code).toBe("UNIQUE_CONSTRAINT_VIOLATION");
      });
    });

    describe("Download URL", () => {
      it.each(["missing", "replaced"])("refuses a %s legacy receipt without a verified copy", async (state) => {
        const artifactId = randomUUID();
        const legacyKey = `ws/${workspace.id}/artifacts/${artifactId}`;
        const original = Buffer.from("%PDF-1.4\nLegacy receipt: 1000 XAF\n%%EOF");
        const replacement = Buffer.from("%PDF-1.4\nLegacy receipt: 900000 XAF\n%%EOF");
        if (state === "replaced") await storage.putObject(legacyKey, replacement, "application/pdf");
        await db.insert(schema.sourceArtifacts).values({
          id: artifactId,
          workspaceId: workspace.id,
          storageKey: legacyKey,
          sha256: createHash("sha256").update(original).digest("hex"),
          mimeType: "application/pdf",
          sizeBytes: BigInt(original.length),
          uploadedByPrincipalId: principal.id,
        });

        const download = await app.inject({
          method: "GET",
          url: `/v1/artifacts/${artifactId}/download-url`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(download.statusCode).toBe(409);
        expect(download.json()).toEqual({ error: { code: "ARTIFACT_INTEGRITY_MISMATCH" } });
      });

      it("does not issue a finalized receipt download URL to another workspace", async () => {
        const artifactId = randomUUID();
        const original = Buffer.from("%PDF-1.4\nPrivate receipt: 1000 XAF\n%%EOF");
        const headers = { authorization: `Bearer ${token}` };
        const presign = await app.inject({
          method: "POST", url: "/v1/artifacts/presign",
          payload: { artifactId, sizeBytes: original.length }, headers,
        });
        expect(presign.statusCode).toBe(200);
        expect((await fetch(presign.json().uploadUrl, { method: "PUT", body: original })).ok).toBe(true);
        expect((await app.inject({
          method: "POST", url: "/v1/artifacts/finalize", payload: { artifactId }, headers,
        })).statusCode).toBe(200);

        const other = await seedWorkspace(db);
        const otherMember = await seedMember(db, {
          workspaceId: other.workspace.id, role: "ADMIN", allBranches: true,
        });
        const otherSession = await createSession(db, {
          principalId: otherMember.principal.id, workspaceId: other.workspace.id,
        });
        const download = await app.inject({
          method: "GET", url: `/v1/artifacts/${artifactId}/download-url`,
          headers: { authorization: `Bearer ${otherSession.token}` },
        });
        expect(download.statusCode).toBe(404);
        expect(download.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
      });

      it("preserves a legacy receipt before an outstanding upload URL replaces its old object", async () => {
        // Existing deployment data: the artifact row points at the client PUT key.
        const artifactId = randomUUID();
        const legacyKey = `ws/${workspace.id}/artifacts/${artifactId}`;
        const original = Buffer.from("%PDF-1.4\nLegacy receipt: 1000 XAF\n%%EOF");
        const replacement = Buffer.from("%PDF-1.4\nLegacy receipt: 900000 XAF\n%%EOF");
        await storage.putObject(legacyKey, original, "application/pdf");
        await db.insert(schema.sourceArtifacts).values({
          id: artifactId,
          workspaceId: workspace.id,
          storageKey: legacyKey,
          sha256: createHash("sha256").update(original).digest("hex"),
          mimeType: "application/pdf",
          sizeBytes: BigInt(original.length),
          uploadedByPrincipalId: principal.id,
        });
        const oldUploadUrl = await storage.presignPut(legacyKey, { expiresSeconds: 900 });
        const download = () => app.inject({
          method: "GET",
          url: `/v1/artifacts/${artifactId}/download-url`,
          headers: { authorization: `Bearer ${token}` },
        });
        const beforeReplacement = await download();
        expect(beforeReplacement.statusCode).toBe(200);

        expect((await fetch(oldUploadUrl, { method: "PUT", body: replacement })).ok).toBe(true);
        const oldDownload = await fetch(beforeReplacement.json().url);
        expect(oldDownload.ok).toBe(true);
        expect(Buffer.from(await oldDownload.arrayBuffer())).toEqual(original);

        const afterReplacement = await download();
        expect(afterReplacement.statusCode).toBe(200);
        const newDownload = await fetch(afterReplacement.json().url);
        expect(newDownload.ok).toBe(true);
        expect(Buffer.from(await newDownload.arrayBuffer())).toEqual(original);
      });

      it("GET download-url returns signed URL for existing artifact", async () => {
        const artifactId = randomUUID();
        const jpegBuffer = await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: 0, g: 0, b: 255 },
          },
        })
          .jpeg()
          .toBuffer();

        // Presign + upload + finalize first
        const presignRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: {
            artifactId,
            fileName: "download-test.jpg",
            sizeBytes: jpegBuffer.length,
          },
          headers: { authorization: `Bearer ${token}` },
        });

        const presignBody = JSON.parse(presignRes.body);
        await fetch(presignBody.uploadUrl, {
          method: "PUT",
          body: jpegBuffer,
          headers: { "Content-Type": "image/jpeg" },
        });

        await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers: { authorization: `Bearer ${token}` },
        });

        // Now request download URL
        const downloadRes = await app.inject({
          method: "GET",
          url: `/v1/artifacts/${artifactId}/download-url`,
          headers: { authorization: `Bearer ${token}` },
        });

        expect(downloadRes.statusCode).toBe(200);
        const body = JSON.parse(downloadRes.body);
        expect(body.url).toContain("http");
      });

      it("GET download-url for nonexistent artifact returns 404", async () => {
        const fakeId = randomUUID();

        const res = await app.inject({
          method: "GET",
          url: `/v1/artifacts/${fakeId}/download-url`,
          headers: { authorization: `Bearer ${token}` },
        });

        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error.code).toBe("REFERENCE_NOT_FOUND");
      });
    });

    describe("Command integration", () => {
      it("POST register-asset with sourceArtifactIds creates linkage", async () => {
        const artifactId = randomUUID();
        const jpegBuffer = await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: 100, g: 100, b: 100 },
          },
        })
          .jpeg()
          .toBuffer();

        // Presign + upload + finalize
        const presignRes = await app.inject({
          method: "POST",
          url: "/v1/artifacts/presign",
          payload: {
            artifactId,
            fileName: "asset-doc.jpg",
            sizeBytes: jpegBuffer.length,
          },
          headers: { authorization: `Bearer ${token}` },
        });

        const presignBody = JSON.parse(presignRes.body);
        await fetch(presignBody.uploadUrl, {
          method: "PUT",
          body: jpegBuffer,
          headers: { "Content-Type": "image/jpeg" },
        });

        await app.inject({
          method: "POST",
          url: "/v1/artifacts/finalize",
          payload: { artifactId },
          headers: { authorization: `Bearer ${token}` },
        });

        // Register asset with sourceArtifactIds
        const assetId = randomUUID();
        const commandId = randomUUID();
        const idempotencyKey = `idem-${randomUUID()}`;

        const commandRes = await app.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            name: "register-asset",
            version: 1,
            envelope: {
              commandId,
              idempotencyKey,
              origin: "HUMAN_UI",
              sourceArtifactIds: [artifactId],
            },
            payload: {
              assetId,
              assetCode: "TRUCK-WITH-ARTIFACT",
              assetClassCode: "TRUCK",
              templateCode: "TRUCKING",
              branchCode: "DLA",
            },
          },
          headers: { authorization: `Bearer ${token}` },
        });

        expect(commandRes.statusCode).toBe(200);
        const body = JSON.parse(commandRes.body);
        expect(body.commandId).toBe(commandId);

        // Verify commandSourceArtifacts row was created
        const rows = await db
          .select()
          .from(schema.commandSourceArtifacts)
          .where(
            eq(schema.commandSourceArtifacts.commandId, commandId),
          );
        expect(rows).toHaveLength(1);
        const row = rows[0];
        if (row) {
          expect(row.artifactId).toBe(artifactId);
        }
      });

      it("POST register-asset with nonexistent sourceArtifactId returns 422", async () => {
        const fakeArtifactId = randomUUID();
        const assetId = randomUUID();
        const commandId = randomUUID();

        const res = await app.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            name: "register-asset",
            version: 1,
            envelope: {
              commandId,
              idempotencyKey: `idem-${randomUUID()}`,
              origin: "HUMAN_UI",
              sourceArtifactIds: [fakeArtifactId],
            },
            payload: {
              assetId,
              assetCode: "TRUCK-NO-ARTIFACT",
              assetClassCode: "TRUCK",
              templateCode: "TRUCKING",
              branchCode: "DLA",
            },
          },
          headers: { authorization: `Bearer ${token}` },
        });

        expect(res.statusCode).toBe(422);
        const body = JSON.parse(res.body);
        expect(body.error.code).toBe("REFERENCE_NOT_FOUND");
      });
    });
  },
);
