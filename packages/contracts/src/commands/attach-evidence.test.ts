import { describe, expect, it } from "vitest";
import { attachEvidencePayload } from "./attach-evidence.js";

const entryId = "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b";
const file = (n: number) => `0b8a4c1e-6f2d-4e3a-9c5b-7d1e2f3a4b${String(n).padStart(2, "0")}`;

describe("attachEvidencePayload", () => {
  it("accepts one to ten distinct files", () => {
    expect(attachEvidencePayload.safeParse({ entryId, artifactIds: [file(1)] }).success).toBe(true);
    expect(
      attachEvidencePayload.safeParse({
        entryId,
        artifactIds: Array.from({ length: 10 }, (_, i) => file(i)),
      }).success,
    ).toBe(true);
  });

  it("refuses no file, eleven files, or the same file twice", () => {
    expect(attachEvidencePayload.safeParse({ entryId, artifactIds: [] }).success).toBe(false);
    expect(
      attachEvidencePayload.safeParse({
        entryId,
        artifactIds: Array.from({ length: 11 }, (_, i) => file(i)),
      }).success,
    ).toBe(false);
    expect(attachEvidencePayload.safeParse({ entryId, artifactIds: [file(1), file(1)] }).success).toBe(
      false,
    );
  });

  it("carries nothing but the entry and its files", () => {
    expect(
      attachEvidencePayload.safeParse({ entryId, artifactIds: [file(1)], amountMinor: 1 }).success,
    ).toBe(false);
  });
});
