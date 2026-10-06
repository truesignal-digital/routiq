import { describe, expect, it } from "vitest";
import {
  assetIdentityProblem,
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
    expect(assetIdentityProblem("chassisNumber", "W".repeat(CHASSIS_NUMBER_MAX_LENGTH))).toBeUndefined();
    expect(assetIdentityProblem("chassisNumber", ` ${"W".repeat(CHASSIS_NUMBER_MAX_LENGTH)} `)).toBeUndefined();
    expect(assetIdentityProblem("chassisNumber", "W".repeat(CHASSIS_NUMBER_MAX_LENGTH + 1))).toBe("tooLong");
    expect(assetIdentityProblem("registrationNumber", "P".repeat(REGISTRATION_NUMBER_MAX_LENGTH + 1))).toBe("tooLong");
  });

  it("treats an empty value as not recorded, not as a problem", () => {
    expect(assetIdentityProblem("registrationNumber", "")).toBeUndefined();
    expect(assetIdentityProblem("chassisNumber", "   ")).toBeUndefined();
  });
});
