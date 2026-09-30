import { describe, expect, it } from "vitest";
import { rejectWorkOrderCompletionCommand } from "./reject-work-order-completion.js";

const envelope = {
  commandId: "b2c3d4e5-f6a7-48b9-c0d1-e2f3a4b5c6d7",
  idempotencyKey: "decision-003",
  origin: "HUMAN_UI" as const,
  sourceArtifactIds: [],
};
const workOrderId = "550e8400-e29b-41d4-a716-446655440001";

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

    expect(rejectWorkOrderCompletionCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an invalid workOrderId UUID", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, workOrderId: "not-a-uuid" },
    };

    expect(rejectWorkOrderCompletionCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const command = {
      ...valid,
      payload: { workOrderId: valid.payload.workOrderId },
    };

    expect(rejectWorkOrderCompletionCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty reason", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "" },
    };

    expect(rejectWorkOrderCompletionCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a reason longer than 500 characters", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "x".repeat(501) },
    };

    expect(rejectWorkOrderCompletionCommand.safeParse(command).success).toBe(false);
  });
});
