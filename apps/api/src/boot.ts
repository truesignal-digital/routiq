/**
 * Production/appliance entrypoint (§6a guard 4): migrate, then serve.
 * Uses the runtime migrator (drizzle-orm), not drizzle-kit — the image
 * carries no dev tooling requirements beyond tsx.
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { authDb, db } from "./db/client.js";
import { initSentry } from "./observability/sentry.js";
import { buildServer } from "./server.js";
import { createS3Storage, ensureBucket, type S3StorageConfig } from "./storage/s3.js";

initSentry();

await migrate(authDb, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});

const s3Endpoint = process.env["S3_ENDPOINT"];
const s3Config: S3StorageConfig | undefined = s3Endpoint
  ? {
      endpoint: s3Endpoint,
      publicEndpoint: process.env["S3_PUBLIC_ENDPOINT"],
      region: process.env["S3_REGION"] ?? "us-east-1",
      bucket: process.env["S3_BUCKET"] ?? "artifacts",
      accessKeyId: process.env["S3_ACCESS_KEY_ID"] ?? "",
      secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] ?? "",
      forcePathStyle: true,
    }
  : undefined;

const app = buildServer({
  db,
  authDb,
  ...(s3Config ? { storage: createS3Storage(s3Config) } : {}),
});

if (s3Config) {
  // Storage trouble must not keep the rest of the API down: log it and serve;
  // uploads answer STORAGE_FAILED until the store is reachable.
  try {
    const bucket = await ensureBucket(s3Config);
    app.log.info({ event: "storage.bucket_ready", bucket: s3Config.bucket, state: bucket });
  } catch (error) {
    app.log.error({ err: error, event: "storage.ensure_bucket_failed", bucket: s3Config.bucket });
  }
}

const port = Number(process.env["PORT"] ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
