import { describe, expect, it } from "vitest";
import { releaseAssetToServiceCommand } from "./release-asset-to-service.js";

const valid = {
  name: "release-asset-to-service",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "release-asset-to-service-001",
    origin: "HUMAN_UI" as const,
    sourceArtifactIds: [],
  },
  payload: {
    assetId: "550e8400-e29b-41d4-a716-446655440001",
    workOrderId: "550e8400-e29b-41d4-a716-446655440000",
  },
};

describe("releaseAssetToServiceCommand", () => {
  it("accepts a valid release-asset-to-service command", () => {
    expect(releaseAssetToServiceCommand.parse(valid).payload.assetId).toBe(
      "550e8400-e29b-41d4-a716-446655440001",
    );
  });

  it("rejects missing assetId", () => {
    expect(
      releaseAssetToServiceCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, assetId: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects missing workOrderId", () => {
    expect(
      releaseAssetToServiceCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: undefined },
      }).success,
    ).toBe(false);
  });

  it("accepts optional note", () => {
    expect(
      releaseAssetToServiceCommand.parse({
        ...valid,
        payload: { ...valid.payload, note: "Ready for service" },
      }).payload.note,
    ).toBe("Ready for service");
  });

  it("rejects note longer than 500 chars", () => {
    expect(
      releaseAssetToServiceCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, note: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
