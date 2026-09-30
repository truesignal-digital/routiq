import { describe, expect, it } from "vitest";
import { reportIssueCommand } from "./report-issue.js";

const valid = {
  name: "report-issue",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "report-issue-001",
    origin: "HUMAN_UI" as const,
    sourceArtifactIds: [],
  },
  payload: {
    issueId: "550e8400-e29b-41d4-a716-446655440000",
    assetId: "550e8400-e29b-41d4-a716-446655440001",
    description: "Tire damage on left side",
    safetyCritical: true,
  },
};

describe("reportIssueCommand", () => {
  it("accepts a valid report-issue command", () => {
    expect(reportIssueCommand.parse(valid).payload.safetyCritical).toBe(true);
  });

  it("rejects missing issueId", () => {
    expect(
      reportIssueCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, issueId: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid assetId", () => {
    expect(
      reportIssueCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, assetId: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });

  it("accepts optional category", () => {
    expect(
      reportIssueCommand.parse({
        ...valid,
        payload: { ...valid.payload, category: "MECHANICAL" },
      }).payload.category,
    ).toBe("MECHANICAL");
  });

  it("rejects description longer than 500 chars", () => {
    expect(
      reportIssueCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, description: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
