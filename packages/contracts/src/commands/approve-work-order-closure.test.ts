import { describe, expect, it } from "vitest";
import { approveWorkOrderClosureCommand } from "./approve-work-order-closure.js";

const valid = {
  name: "approve-work-order-closure",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "approve-work-order-closure-001",
    origin: "HUMAN_UI" as const,
    expectedVersion: 2,
    sourceArtifactIds: [],
  },
  payload: {
    workOrderId: "550e8400-e29b-41d4-a716-446655440000",
  },
};

describe("approveWorkOrderClosureCommand", () => {
  it("accepts a valid approve-work-order-closure command", () => {
    expect(
      approveWorkOrderClosureCommand.parse(valid).payload.workOrderId,
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("carries the expected version that decides the race", () => {
    expect(
      approveWorkOrderClosureCommand.parse(valid).envelope.expectedVersion,
    ).toBe(2);
  });

  it("rejects missing workOrderId", () => {
    expect(
      approveWorkOrderClosureCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid workOrderId", () => {
    expect(
      approveWorkOrderClosureCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });

  it("accepts an optional note", () => {
    expect(
      approveWorkOrderClosureCommand.parse({
        ...valid,
        payload: { ...valid.payload, note: "Coûts réels acceptés" },
      }).payload.note,
    ).toBe("Coûts réels acceptés");
  });

  it("rejects an empty note", () => {
    expect(
      approveWorkOrderClosureCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, note: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects a note longer than 500 chars", () => {
    expect(
      approveWorkOrderClosureCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, note: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
