import { describe, expect, it } from "vitest";
import { rejectWorkOrderCommand } from "./reject-work-order.js";

const envelope = {
  commandId: "a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6",
  idempotencyKey: "decision-002",
  origin: "HUMAN_UI" as const,
  sourceArtifactIds: [],
};
const workOrderId = "550e8400-e29b-41d4-a716-446655440001";

describe("reject-work-order contract", () => {
  const valid = {
    name: "reject-work-order",
    version: 1,
    envelope,
    payload: { workOrderId, reason: "Insufficient budget" },
  };

  it("accepts a valid rejection with a reason", () => {
    expect(rejectWorkOrderCommand.parse(valid).payload.reason).toBe("Insufficient budget");
  });

  it("rejects a missing workOrderId", () => {
    const command = {
      ...valid,
      payload: { reason: valid.payload.reason },
    };

    expect(rejectWorkOrderCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an invalid workOrderId UUID", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, workOrderId: "not-a-uuid" },
    };

    expect(rejectWorkOrderCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const command = {
      ...valid,
      payload: { workOrderId: valid.payload.workOrderId },
    };

    expect(rejectWorkOrderCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty reason", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "" },
    };

    expect(rejectWorkOrderCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a reason longer than 500 characters", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "x".repeat(501) },
    };

    expect(rejectWorkOrderCommand.safeParse(command).success).toBe(false);
  });
});
