import { describe, expect, it } from "vitest";
import {
  assetIdentityFields,
  CHASSIS_NUMBER_MAX_LENGTH,
  plateKey,
  REGISTRATION_NUMBER_MAX_LENGTH,
} from "./asset-identity.js";

describe("asset identity rules", () => {
  it("reads one plate however it is spaced, dashed or cased", () => {
    expect(plateKey("LT 482 AB")).toBe("LT482AB");
    expect(plateKey("lt-482-ab")).toBe("LT482AB");
    expect(plateKey(" lt482ab\t")).toBe("LT482AB");
  });

  it("finds a value too long only past the limit, after trimming", () => {
    const { chassisNumber, registrationNumber } = assetIdentityFields;
    expect(chassisNumber.safeParse("W".repeat(CHASSIS_NUMBER_MAX_LENGTH)).success).toBe(true);
    expect(chassisNumber.safeParse(` ${"W".repeat(CHASSIS_NUMBER_MAX_LENGTH)} `).success).toBe(true);
    expect(chassisNumber.safeParse("W".repeat(CHASSIS_NUMBER_MAX_LENGTH + 1)).success).toBe(false);
    expect(registrationNumber.safeParse("P".repeat(REGISTRATION_NUMBER_MAX_LENGTH + 1)).success).toBe(false);
  });

  it("refuses a blank value: an empty field is no plate at all, sent as nothing", () => {
    expect(assetIdentityFields.registrationNumber.safeParse("   ").success).toBe(false);
    expect(assetIdentityFields.chassisNumber.safeParse("").success).toBe(false);
  });
});
