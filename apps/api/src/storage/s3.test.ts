import { describe, expect, it } from "vitest";
import { createS3Storage } from "./s3.js";

const base = {
  endpoint: "http://storage:9000",
  region: "us-east-1",
  bucket: "artifacts",
  accessKeyId: "key",
  secretAccessKey: "secret",
  forcePathStyle: true,
};

describe("createS3Storage presigning", () => {
  it("signs browser-facing URLs against the public endpoint when one is set", async () => {
    const storage = createS3Storage({ ...base, publicEndpoint: "http://localhost:9000" });

    const put = new URL(await storage.presignPut("ws/a/artifacts/b", { contentType: "application/octet-stream" }));
    const get = new URL(await storage.presignGet("ws/a/artifacts/b"));

    expect(put.origin).toBe("http://localhost:9000");
    expect(put.pathname).toBe("/artifacts/ws/a/artifacts/b");
    expect(get.origin).toBe("http://localhost:9000");
  });

  it("signs against the API's own endpoint when no public endpoint is set", async () => {
    const storage = createS3Storage(base);

    const put = new URL(await storage.presignPut("k", {}));

    expect(put.origin).toBe("http://storage:9000");
  });
});
