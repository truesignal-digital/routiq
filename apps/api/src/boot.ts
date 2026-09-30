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
import { createS3Storage } from "./storage/s3.js";
import type { ObjectStorage } from "./storage/types.js";

initSentry();

await migrate(authDb, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});

let storage: ObjectStorage | undefined;
const s3Endpoint = process.env["S3_ENDPOINT"];
if (s3Endpoint) {
  storage = createS3Storage({
    endpoint: s3Endpoint,
    region: process.env["S3_REGION"] ?? "us-east-1",
    bucket: process.env["S3_BUCKET"] ?? "artifacts",
    accessKeyId: process.env["S3_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] ?? "",
    publicEndpoint: process.env["S3_PUBLIC_ENDPOINT"],
    forcePathStyle: true,
  });
}

const app = buildServer({ db, authDb, ...(storage ? { storage } : {}) });
const port = Number(process.env["PORT"] ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
