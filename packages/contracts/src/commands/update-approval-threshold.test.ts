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

  it("accepts the work-order pair, whose bands a tenant configures here (#47)", () => {
    for (const commandType of ["create-work-order", "complete-work-order"] as const) {
      expect(
        updateApprovalThresholdPayload.parse({ commandType, amountMaxMinor: 500_000 }),
      ).toEqual({ commandType, amountMaxMinor: 500_000 });
    }
  });

  it("rejects a command type with no amount band, like a work-order decision", () => {
    expect(
      updateApprovalThresholdPayload.safeParse({
        commandType: "approve-work-order",
        amountMaxMinor: 1,
      }).success,
    ).toBe(false);
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
