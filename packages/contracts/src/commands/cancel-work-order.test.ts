import { describe, expect, it } from "vitest";
import { cancelWorkOrderCommand } from "./cancel-work-order.js";

const valid = {
  name: "cancel-work-order",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "cancel-work-order-001",
    origin: "HUMAN_UI" as const,
    sourceArtifactIds: [],
  },
  payload: {
    workOrderId: "550e8400-e29b-41d4-a716-446655440000",
    reason: "Asset no longer needs repair",
  },
};

describe("cancelWorkOrderCommand", () => {
  it("accepts a valid cancel-work-order command", () => {
    expect(cancelWorkOrderCommand.parse(valid).payload.reason).toBe(
      "Asset no longer needs repair",
    );
  });

  it("rejects missing workOrderId", () => {
    expect(
      cancelWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects missing reason", () => {
    expect(
      cancelWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, reason: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects empty reason", () => {
    expect(
      cancelWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, reason: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects reason longer than 500 chars", () => {
    expect(
      cancelWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, reason: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
