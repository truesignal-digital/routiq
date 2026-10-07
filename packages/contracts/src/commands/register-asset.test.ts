import { describe, expect, it } from "vitest";
import { assetDetailFields } from "./update-asset-details.js";
import { registerAssetCommand, registerAssetPayload, registerAssetV1Command, registerAssetV1Payload } from "./register-asset.js";

const valid = {
  name: "register-asset",
  version: 2,
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

  it("holds the plate and chassis number to the Details edit's rules (#122)", () => {
    const parse = (fields: Record<string, unknown>) =>
      registerAssetPayload.safeParse({ ...valid.payload, ...fields });
    expect(parse({ chassisNumber: "WDB9634031L123456" }).success).toBe(true);
    expect(parse({ chassisNumber: "WDB9634031L1234567" }).success).toBe(false);
    expect(parse({ registrationNumber: "x".repeat(41) }).success).toBe(false);
    expect(parse({ registrationNumber: "   " }).success).toBe(false);
    expect(parse({ registrationNumber: "  LT 482 AB " }).data?.registrationNumber).toBe("LT 482 AB");
    for (const value of ["WDB9634031L123456", "WDB9634031L1234567", "   ", "x".repeat(41)]) {
      for (const field of ["registrationNumber", "chassisNumber"] as const) {
        expect(parse({ [field]: value }).success).toBe(assetDetailFields[field].safeParse(value).success);
      }
    }
  });

  it("names itself version 2", () => {
    expect(registerAssetCommand.safeParse({ ...valid, version: 1 }).success).toBe(false);
  });
});

describe("register-asset v1 (frozen)", () => {
  it("still takes what it shipped with: a 60-character chassis number, an untrimmed plate", () => {
    const payload = registerAssetV1Payload.parse({
      ...valid.payload,
      chassisNumber: "C".repeat(60),
      registrationNumber: " LT 482 AB ",
    });
    expect(payload.chassisNumber).toHaveLength(60);
    expect(payload.registrationNumber).toBe(" LT 482 AB ");
    expect(registerAssetV1Command.safeParse({ ...valid, version: 1 }).success).toBe(true);
    expect(registerAssetV1Payload.safeParse({ ...valid.payload, chassisNumber: "C".repeat(61) }).success).toBe(false);
  });
});
