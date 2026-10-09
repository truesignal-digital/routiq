import { describe, expect, it } from "vitest";
import { changeIssueSeverityCommand } from "./change-issue-severity.js";

const envelope = {
  commandId: "c3d4e5f6-a7b8-49c0-91e2-f3a4b5c6d7e8",
  idempotencyKey: "severity-001",
  origin: "HUMAN_UI" as const,
  expectedVersion: 1,
  sourceArtifactIds: [],
};
const issueId = "550e8400-e29b-41d4-a716-446655440000";

function command(payload: Record<string, unknown>) {
  return { name: "change-issue-severity", version: 1, envelope, payload };
}

/** Paths of the fields a parse rejects, so a rejection is proven to come from the field under test. */
function rejectedPaths(input: unknown): string[] {
  const result = changeIssueSeverityCommand.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("change-issue-severity contract", () => {
  it("accepts a raise with no reason: the driver only forgot the box", () => {
    expect(
      changeIssueSeverityCommand.parse(command({ issueId, safetyCritical: true })).payload,
    ).toEqual({ issueId, safetyCritical: true });
  });

  it("accepts a lower with a reason, trimmed", () => {
    expect(
      changeIssueSeverityCommand.parse(
        command({ issueId, safetyCritical: false, reason: "  Rétroviseur, pas les freins " }),
      ).payload.reason,
    ).toBe("Rétroviseur, pas les freins");
  });

  it("refuses a lower without a reason, or with a blank one", () => {
    expect(rejectedPaths(command({ issueId, safetyCritical: false }))).toEqual(["payload.reason"]);
    expect(rejectedPaths(command({ issueId, safetyCritical: false, reason: "   " }))).toEqual([
      "payload.reason",
    ]);
  });

  it("refuses an oversized reason", () => {
    expect(
      rejectedPaths(command({ issueId, safetyCritical: true, reason: "x".repeat(501) })),
    ).toEqual(["payload.reason"]);
  });

  it("requires the issue and the mark wanted", () => {
    expect(rejectedPaths(command({ safetyCritical: true }))).toEqual(["payload.issueId"]);
    expect(rejectedPaths(command({ issueId: "not-a-uuid", safetyCritical: true }))).toEqual([
      "payload.issueId",
    ]);
    expect(rejectedPaths(command({ issueId }))).toEqual(["payload.safetyCritical"]);
  });

  it("refuses fields it does not know, such as a reporter named by the client", () => {
    expect(
      rejectedPaths(command({ issueId, safetyCritical: true, reportedBy: issueId })),
    ).toEqual(["payload"]);
  });
});
