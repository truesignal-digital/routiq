import { describe, expect, it } from "vitest";
import { completeWorkOrderCommand } from "./complete-work-order.js";

const valid = {
  name: "complete-work-order",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "complete-work-order-001",
    origin: "HUMAN_UI" as const,
    sourceArtifactIds: [],
  },
  payload: {
    workOrderId: "550e8400-e29b-41d4-a716-446655440000",
    currency: "XAF",
  },
};

describe("completeWorkOrderCommand", () => {
  it("accepts a valid complete-work-order command", () => {
    expect(completeWorkOrderCommand.parse(valid).payload.workOrderId).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("rejects missing workOrderId", () => {
    expect(
      completeWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: undefined },
      }).success,
    ).toBe(false);
  });

  it("accepts optional actualCostMinor", () => {
    expect(
      completeWorkOrderCommand.parse({
        ...valid,
        payload: { ...valid.payload, actualCostMinor: 45000 },
      }).payload.actualCostMinor,
    ).toBe(45000);
  });

  it("rejects negative actualCostMinor", () => {
    expect(
      completeWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, actualCostMinor: -100 },
      }).success,
    ).toBe(false);
  });

  it("accepts optional summary", () => {
    expect(
      completeWorkOrderCommand.parse({
        ...valid,
        payload: { ...valid.payload, summary: "Tire replaced successfully" },
      }).payload.summary,
    ).toBe("Tire replaced successfully");
  });
});
