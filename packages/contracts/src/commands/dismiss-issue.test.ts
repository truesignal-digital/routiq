import { describe, expect, it } from "vitest";
import { dismissIssueCommand } from "./dismiss-issue.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "decision-001",
  origin: "HUMAN_UI" as const,
  sourceArtifactIds: [],
};
const issueId = "550e8400-e29b-41d4-a716-446655440000";

describe("dismiss-issue contract", () => {
  const valid = {
    name: "dismiss-issue",
    version: 1,
    envelope,
    payload: { issueId, reason: "Duplicate report" },
  };

  it("accepts a valid dismissal with a reason", () => {
    expect(dismissIssueCommand.parse(valid).payload.reason).toBe("Duplicate report");
  });

  it("rejects a missing issueId", () => {
    const command = {
      ...valid,
      payload: { reason: valid.payload.reason },
    };

    expect(dismissIssueCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an invalid issueId UUID", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, issueId: "not-a-uuid" },
    };

    expect(dismissIssueCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const command = {
      ...valid,
      payload: { issueId: valid.payload.issueId },
    };

    expect(dismissIssueCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty reason", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "" },
    };

    expect(dismissIssueCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a reason longer than 500 characters", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "x".repeat(501) },
    };

    expect(dismissIssueCommand.safeParse(command).success).toBe(false);
  });
});
