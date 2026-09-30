import { describe, expect, it } from "vitest";
import { resolveIssueCommand } from "./resolve-issue.js";

const envelope = {
  commandId: "c3d4e5f6-a7b8-49c0-91e2-f3a4b5c6d7e8",
  idempotencyKey: "decision-004",
  origin: "HUMAN_UI" as const,
  sourceArtifactIds: [],
};
const issueId = "550e8400-e29b-41d4-a716-446655440000";


/** Paths of the fields a parse rejects, so a rejection is proven to come from the field under test. */
function rejectedPaths(input: unknown): string[] {
  const result = resolveIssueCommand.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("resolve-issue contract", () => {
  const valid = {
    name: "resolve-issue",
    version: 1,
    envelope,
    payload: { issueId },
  };

  it("accepts a resolution with no note — fixed on the spot needs no essay", () => {
    expect(resolveIssueCommand.parse(valid).payload.issueId).toBe(issueId);
  });

  it("accepts an optional note", () => {
    expect(
      resolveIssueCommand.parse({
        ...valid,
        payload: { issueId, note: "Collier resserré" },
      }).payload.note,
    ).toBe("Collier resserré");
  });

  it("rejects an empty or oversized note", () => {
    for (const note of ["", "x".repeat(501)]) {
      expect(
        rejectedPaths({ ...valid, payload: { issueId, note } }),
      ).toEqual(["payload.note"]);
    }
  });

  it("rejects a missing issueId", () => {
    const command = {
      ...valid,
      payload: {},
    };

    expect(rejectedPaths(command)).toEqual(["payload.issueId"]);
  });

  it("rejects an invalid issueId UUID", () => {
    const command = {
      ...valid,
      payload: { issueId: "not-a-uuid" },
    };

    expect(rejectedPaths(command)).toEqual(["payload.issueId"]);
  });
});
