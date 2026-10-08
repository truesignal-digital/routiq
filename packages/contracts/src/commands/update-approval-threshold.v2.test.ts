import { describe, expect, it } from "vitest";
import {
  thresholdBandsProblem,
  updateApprovalThresholdV2Payload,
} from "./update-approval-threshold.js";

describe("updateApprovalThresholdV2Payload (#354)", () => {
  it("carries both bands of the money chain in whole XAF", () => {
    const payload = { recordingThresholdMinor: 100_000, financeCeilingMinor: 1_000_000 };
    expect(updateApprovalThresholdV2Payload.parse(payload)).toEqual(payload);
  });

  it("refuses fractions, negatives and a zero ceiling", () => {
    for (const payload of [
      { recordingThresholdMinor: 100_000.5, financeCeilingMinor: 1_000_000 },
      { recordingThresholdMinor: -1, financeCeilingMinor: 1_000_000 },
      { recordingThresholdMinor: 0, financeCeilingMinor: 0 },
    ]) {
      expect(updateApprovalThresholdV2Payload.safeParse(payload).success).toBe(false);
    }
  });

  it("keeps the recording threshold strictly below the Finance ceiling", () => {
    expect(thresholdBandsProblem({ recordingThresholdMinor: 0, financeCeilingMinor: 1 })).toBeUndefined();
    expect(
      thresholdBandsProblem({ recordingThresholdMinor: 1_000_000, financeCeilingMinor: 1_000_000 }),
    ).toBe("RECORDING_THRESHOLD_NOT_BELOW_CEILING");
    expect(
      thresholdBandsProblem({ recordingThresholdMinor: 2_000_000, financeCeilingMinor: 1_000_000 }),
    ).toBe("RECORDING_THRESHOLD_NOT_BELOW_CEILING");
  });
});
