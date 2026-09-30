import { describe, expect, it } from "vitest";
import { rejectWorkOrderCompletionCommand } from "./reject-work-order-completion.js";

const envelope = {
  commandId: "b2c3d4e5-f6a7-48b9-a0d1-e2f3a4b5c6d7",
  idempotencyKey: "decision-003",
  origin: "HUMAN_UI" as const,
  sourceArtifactIds: [],
};
const workOrderId = "550e8400-e29b-41d4-a716-446655440001";


/** Paths of the fields a parse rejects, so a rejection is proven to come from the field under test. */
function rejectedPaths(input: unknown): string[] {
  const result = rejectWorkOrderCompletionCommand.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("reject-work-order-completion contract", () => {
  const valid = {
    name: "reject-work-order-completion",
    version: 1,
    envelope,
    payload: { workOrderId, reason: "Missing invoice documents" },
  };

  it("accepts a valid rejection with a reason", () => {
    expect(rejectWorkOrderCompletionCommand.parse(valid).payload.reason).toBe(
      "Missing invoice documents",
    );
  });

  it("rejects a missing workOrderId", () => {
    const command = {
      ...valid,
      payload: { reason: valid.payload.reason },
    };

    expect(rejectedPaths(command)).toEqual(["payload.workOrderId"]);
  });

  it("rejects an invalid workOrderId UUID", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, workOrderId: "not-a-uuid" },
    };

    expect(rejectedPaths(command)).toEqual(["payload.workOrderId"]);
  });

  it("rejects a missing reason", () => {
    const command = {
      ...valid,
      payload: { workOrderId: valid.payload.workOrderId },
    };

    expect(rejectedPaths(command)).toEqual(["payload.reason"]);
  });

  it("rejects an empty reason", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "" },
    };

    expect(rejectedPaths(command)).toEqual(["payload.reason"]);
  });

  it("rejects a whitespace-only reason", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "   " },
    };

    expect(rejectedPaths(command)).toEqual(["payload.reason"]);
  });

  it("rejects a reason longer than 500 characters", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "x".repeat(501) },
    };

    expect(rejectedPaths(command)).toEqual(["payload.reason"]);
  });
});
