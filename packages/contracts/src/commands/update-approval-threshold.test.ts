import { describe, expect, it } from "vitest";
import { updateApprovalThresholdPayload } from "./update-approval-threshold.js";

describe("updateApprovalThresholdPayload", () => {
  it("round-trips a valid payload", () => {
    const payload = {
      commandType: "record-expense" as const,
      amountMaxMinor: 200_000,
    };

    expect(updateApprovalThresholdPayload.parse(JSON.parse(JSON.stringify(payload)))).toEqual(
      payload,
    );
  });

  it("accepts zero amountMaxMinor", () => {
    expect(
      updateApprovalThresholdPayload.parse({
        commandType: "record-revenue",
        amountMaxMinor: 0,
      }),
    ).toEqual({
      commandType: "record-revenue",
      amountMaxMinor: 0,
    });
  });

  it("rejects negative amountMaxMinor", () => {
    expect(
      updateApprovalThresholdPayload.safeParse({
        commandType: "record-expense",
        amountMaxMinor: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown commandType", () => {
    expect(
      updateApprovalThresholdPayload.safeParse({
        commandType: "unknown-command",
        amountMaxMinor: 100_000,
      }).success,
    ).toBe(false);
  });
});
