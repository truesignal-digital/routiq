import { describe, expect, it } from "vitest";
import { commandEnvelope } from "../envelope.js";
import { createSubmission } from "./submission.js";

describe("createSubmission", () => {
  it("produces a valid envelope with generated ids", () => {
    const submission = createSubmission("register-asset", 1, { code: "DLA-001" });

    const parsed = commandEnvelope.parse(submission.envelope);
    expect(parsed.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(parsed.origin).toBe("HUMAN_UI");
    expect(submission.name).toBe("register-asset");
    expect(submission.version).toBe(1);
    expect(submission.payload).toEqual({ code: "DLA-001" });
  });

  it("ids are created once per submission — stable across retries", () => {
    const submission = createSubmission("register-asset", 1, {});
    const first = { ...submission.envelope };
    // A retry re-posts the same submission object; nothing regenerates.
    expect(submission.envelope.commandId).toBe(first.commandId);
    expect(submission.envelope.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("two submissions never share ids", () => {
    const a = createSubmission("register-asset", 1, {});
    const b = createSubmission("register-asset", 1, {});
    expect(a.envelope.commandId).not.toBe(b.envelope.commandId);
    expect(a.envelope.idempotencyKey).not.toBe(b.envelope.idempotencyKey);
  });

  it("carries expectedVersion and sourceArtifactIds when supplied", () => {
    const artifactId = crypto.randomUUID();
    const submission = createSubmission(
      "assign-asset",
      1,
      {},
      { expectedVersion: 3, sourceArtifactIds: [artifactId] },
    );
    expect(submission.envelope.expectedVersion).toBe(3);
    expect(submission.envelope.sourceArtifactIds).toEqual([artifactId]);
  });

  it("supports a non-default origin for future callers", () => {
    const submission = createSubmission("register-asset", 1, {}, { origin: "OFFLINE_SYNC" });
    expect(submission.envelope.origin).toBe("OFFLINE_SYNC");
  });
});
