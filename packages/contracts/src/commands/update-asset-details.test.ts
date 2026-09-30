import { describe, expect, it } from "vitest";
import {
  assetDetailFields,
  latestModelYear,
  updateAssetDetailsCommand,
  updateAssetDetailsPayload,
} from "./update-asset-details.js";

const ASSET_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const command = (payload: Record<string, unknown>) => ({
  name: "update-asset-details",
  version: 1,
  envelope: {
    commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
    idempotencyKey: "device1-0042",
    origin: "HUMAN_UI",
    expectedVersion: 3,
    sourceArtifactIds: [],
  },
  payload: { assetId: ASSET_ID, ...payload },
});

describe("update-asset-details contract", () => {
  it("accepts only the changed fields, trimmed", () => {
    const parsed = updateAssetDetailsCommand.parse(command({ registrationNumber: "  LT 132 AB " }));
    expect(parsed.payload).toEqual({ assetId: ASSET_ID, registrationNumber: "LT 132 AB" });
  });

  it("clears a field with null, and patches specifications by key", () => {
    const parsed = updateAssetDetailsPayload.parse({
      assetId: ASSET_ID,
      chassisNumber: null,
      customValues: { axleCount: 3, tonnageCapacity: null },
    });
    expect(parsed).toEqual({
      assetId: ASSET_ID,
      chassisNumber: null,
      customValues: { axleCount: 3, tonnageCapacity: null },
    });
  });

  it("refuses a call that changes nothing", () => {
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID }).success).toBe(false);
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, customValues: {} }).success).toBe(false);
  });

  it("refuses the fields it does not edit", () => {
    for (const field of ["assetCode", "assetClassCode", "templateCode", "branchCode", "lifecycleStatus"]) {
      expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, [field]: "X" }).success, field).toBe(false);
    }
  });

  it("bounds the model year from 1950 to next year", () => {
    const next = latestModelYear();
    expect(assetDetailFields.modelYear.safeParse(1950).success).toBe(true);
    expect(assetDetailFields.modelYear.safeParse(next).success).toBe(true);
    expect(assetDetailFields.modelYear.safeParse(1949).success).toBe(false);
    expect(assetDetailFields.modelYear.safeParse(next + 1).success).toBe(false);
    expect(assetDetailFields.modelYear.safeParse(2019.5).success).toBe(false);
    expect(latestModelYear(new Date("2026-09-30T12:00:00Z"))).toBe(2027);
  });

  it("holds a chassis number to 17 characters", () => {
    expect(assetDetailFields.chassisNumber.safeParse("WDB9634031L123456").success).toBe(true);
    expect(assetDetailFields.chassisNumber.safeParse("WDB9634031L1234567").success).toBe(false);
  });

  it("takes the acquisition amount in whole francs, never negative", () => {
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, acquisitionAmountMinor: 45_000_000 }).success).toBe(true);
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, acquisitionAmountMinor: 1500.5 }).success).toBe(false);
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, acquisitionAmountMinor: -1 }).success).toBe(false);
  });

  it("refuses an empty string where null means cleared", () => {
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, manufacturer: "   " }).success).toBe(false);
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, customValues: { bodyType: " " } }).success).toBe(false);
  });

  it("refuses a malformed acquisition date", () => {
    expect(updateAssetDetailsPayload.safeParse({ assetId: ASSET_ID, acquisitionDate: "01/03/2024" }).success).toBe(false);
  });
});
