import { describe, expect, it } from "vitest";
import { approveWorkOrderCommand } from "./approve-work-order.js";

const valid = {
  name: "approve-work-order",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "approve-work-order-001",
    origin: "HUMAN_UI" as const,
    expectedVersion: 1,
    sourceArtifactIds: [],
  },
  payload: {
    workOrderId: "550e8400-e29b-41d4-a716-446655440000",
  },
};

describe("approveWorkOrderCommand", () => {
  it("accepts a valid approve-work-order command", () => {
    expect(approveWorkOrderCommand.parse(valid).payload.workOrderId).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("carries the expected version that decides the race", () => {
    expect(approveWorkOrderCommand.parse(valid).envelope.expectedVersion).toBe(1);
  });

  it("rejects missing workOrderId", () => {
    expect(
      approveWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid workOrderId", () => {
    expect(
      approveWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });

  it("accepts an optional note", () => {
    expect(
      approveWorkOrderCommand.parse({
        ...valid,
        payload: { ...valid.payload, note: "Devis validé par l'atelier" },
      }).payload.note,
    ).toBe("Devis validé par l'atelier");
  });

  it("rejects an empty note", () => {
    expect(
      approveWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, note: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects a note longer than 500 chars", () => {
    expect(
      approveWorkOrderCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, note: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
