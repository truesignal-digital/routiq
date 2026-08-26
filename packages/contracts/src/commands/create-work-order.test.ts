import { describe, expect, it } from "vitest";
import { createWorkOrderCommand } from "./create-work-order.js";

const valid = {
  name: "create-work-order",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "create-work-order-001",
    origin: "HUMAN_UI" as const,
    sourceArtifactIds: [],
  },
  payload: {
    workOrderId: "550e8400-e29b-41d4-a716-446655440000",
    assetId: "550e8400-e29b-41d4-a716-446655440001",
    description: "Replace tire",
    currency: "XAF",
  },
};

describe("createWorkOrderCommand", () => {
  it("accepts a valid create-work-order command", () => {
    expect(createWorkOrderCommand.parse(valid).payload.currency).toBe("XAF");
  });

  it("rejects missing workOrderId", () => {
    expect(
      createWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: undefined },
      }).success,
    ).toBe(false);
  });

  it("accepts optional issueId", () => {
    expect(
      createWorkOrderCommand.parse({
        ...valid,
        payload: { ...valid.payload, issueId: "550e8400-e29b-41d4-a716-446655440002" },
      }).payload.issueId,
    ).toBe("550e8400-e29b-41d4-a716-446655440002");
  });

  it("accepts optional expectedCostMinor", () => {
    expect(
      createWorkOrderCommand.parse({
        ...valid,
        payload: { ...valid.payload, expectedCostMinor: 50000 },
      }).payload.expectedCostMinor,
    ).toBe(50000);
  });

  it("rejects negative expectedCostMinor", () => {
    expect(
      createWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, expectedCostMinor: -100 },
      }).success,
    ).toBe(false);
  });
});
