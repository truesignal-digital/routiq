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

  it("accepts a release that names no work order — the server finds the one answering the grounding", () => {
    const { workOrderId: _omitted, ...withoutWorkOrder } = valid.payload;
    expect(
      releaseAssetToServiceCommand.safeParse({
        ...valid,
        payload: withoutWorkOrder,
      }).success,
    ).toBe(true);
  });

  it("carries an override reason for a grounding closed without a work order", () => {
    expect(
      releaseAssetToServiceCommand.parse({
        ...valid,
        payload: { assetId: valid.payload.assetId, overrideReason: "Signalement classé" },
      }).payload.overrideReason,
    ).toBe("Signalement classé");
  });

  it("rejects an empty override reason", () => {
    expect(
      releaseAssetToServiceCommand.safeParse({
        ...valid,
        payload: { assetId: valid.payload.assetId, overrideReason: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid workOrderId", () => {
    expect(
      releaseAssetToServiceCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: "not-a-uuid" },
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
