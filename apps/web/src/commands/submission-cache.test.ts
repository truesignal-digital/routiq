import { describe, expect, it } from "vitest";
import { SubmissionCache } from "./submission-cache.js";

describe("SubmissionCache", () => {
  it("unchanged payload reuses the same submission — idempotency key stable across retries", () => {
    const cache = new SubmissionCache<{ code: string }>("register-asset", 1);
    const first = cache.for({ code: "DLA-1" });
    const retry = cache.for({ code: "DLA-1" });
    expect(retry.envelope.idempotencyKey).toBe(first.envelope.idempotencyKey);
    expect(retry.envelope.commandId).toBe(first.envelope.commandId);
  });

  it("edited payload gets a fresh submission — never reuses a key with different content", () => {
    const cache = new SubmissionCache<{ code: string }>("register-asset", 1);
    const first = cache.for({ code: "DLA-1" });
    const edited = cache.for({ code: "DLA-2" });
    expect(edited.envelope.idempotencyKey).not.toBe(first.envelope.idempotencyKey);
  });

  it("reverting an edit back to the original content is a new submission (the old attempt may have partially landed)", () => {
    const cache = new SubmissionCache<{ code: string }>("register-asset", 1);
    const first = cache.for({ code: "DLA-1" });
    cache.for({ code: "DLA-2" });
    const reverted = cache.for({ code: "DLA-1" });
    expect(reverted.envelope.idempotencyKey).not.toBe(first.envelope.idempotencyKey);
  });
});
