import { describe, expect, it } from "vitest";
import { registerAssetCommand } from "./register-asset.js";

const valid = {
  name: "register-asset",
  version: 1,
  envelope: {
    commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
    idempotencyKey: "device1-0001",
    origin: "HUMAN_UI",
    sourceArtifactIds: [],
  },
  payload: {
    assetId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    assetCode: "TRK-014",
    assetClassCode: "TRUCK",
    templateCode: "TRUCKING",
    branchCode: "DLA",
    customValues: {},
  },
} as const;

describe("register-asset contract", () => {
  it("accepts a valid command", () => {
    expect(registerAssetCommand.parse(valid).payload.assetCode).toBe("TRK-014");
  });

  it("rejects a non-integer money amount", () => {
    const bad = structuredClone(valid) as Record<string, unknown>;
    (bad as typeof valid & { payload: { acquisitionAmountMinor: number } }).payload =
      { ...valid.payload, acquisitionAmountMinor: 1500.5 };
    expect(registerAssetCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown origin", () => {
    const bad = {
      ...valid,
      envelope: { ...valid.envelope, origin: "ROBOT" },
    };
    expect(registerAssetCommand.safeParse(bad).success).toBe(false);
  });
});
