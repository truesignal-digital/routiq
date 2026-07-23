import { describe, expect, it } from "vitest";
import { uploadArtifact } from "./upload.js";

function makeFile(): Blob {
  return new Blob(["receipt"], { type: "image/jpeg" });
}

function flow(responses: Array<[number, unknown]>): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    const [status, body] = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return new Response(body === null ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("uploadArtifact", () => {
  it("presign → PUT → finalize happy path", async () => {
    const { fetchImpl, urls } = flow([
      [200, { artifactId: "a1", storageKey: "k", uploadUrl: "https://s3/put" }],
      [200, null],
      [200, { id: "a1", sha256: "abc123", sizeBytes: 7 }],
    ]);
    const result = await uploadArtifact("a1", makeFile(), "r.jpg", "tok", fetchImpl);
    expect(result).toEqual({ ok: true, artifact: { id: "a1", sha256: "abc123", sizeBytes: 7 } });
    expect(urls).toEqual(["/v1/artifacts/presign", "https://s3/put", "/v1/artifacts/finalize"]);
  });

  it("finalize retry hitting the duplicate constraint is already-done, not an error", async () => {
    const { fetchImpl } = flow([
      [200, { artifactId: "a1", storageKey: "k", uploadUrl: "https://s3/put" }],
      [200, null],
      [409, { error: { code: "UNIQUE_CONSTRAINT_VIOLATION" } }],
    ]);
    const result = await uploadArtifact("a1", makeFile(), "r.jpg", "tok", fetchImpl);
    expect(result.ok).toBe(true);
  });

  it("unsupported media type surfaces its stable code", async () => {
    const { fetchImpl } = flow([
      [200, { artifactId: "a1", storageKey: "k", uploadUrl: "https://s3/put" }],
      [200, null],
      [422, { error: { code: "UNSUPPORTED_MEDIA_TYPE" } }],
    ]);
    const result = await uploadArtifact("a1", makeFile(), "r.jpg", "tok", fetchImpl);
    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("failed PUT reports STORAGE_FAILED and never calls finalize", async () => {
    const { fetchImpl, urls } = flow([
      [200, { artifactId: "a1", storageKey: "k", uploadUrl: "https://s3/put" }],
      [500, null],
    ]);
    const result = await uploadArtifact("a1", makeFile(), "r.jpg", "tok", fetchImpl);
    expect(result).toEqual({ ok: false, code: "STORAGE_FAILED" });
    expect(urls).toHaveLength(2);
  });
});
