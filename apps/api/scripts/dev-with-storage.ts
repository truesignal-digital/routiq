// Dev bootstrap WITH object storage (server.ts main block doesn't wire it yet
// — backend: consider env-driven storage there, then delete this script).
import "dotenv/config";
import { db } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { createS3Storage } from "../src/storage/s3.js";

const storage = createS3Storage({
  endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9100",
  region: "us-east-1",
  bucket: process.env["S3_BUCKET"] ?? "artifacts",
  accessKeyId: process.env["S3_ACCESS_KEY"] ?? "routiq",
  secretAccessKey: process.env["S3_SECRET_KEY"] ?? "assetsecret",
  forcePathStyle: true,
});

const app = buildServer({ db, storage });
const port = Number(process.env["PORT"] ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
