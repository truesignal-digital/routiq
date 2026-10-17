import { describe, expect, it } from "vitest";
import { periodsResponse } from "./finance.js";

const period = {
  periodCode: "2026-09",
  status: "LOCKED",
  lockedAt: "2026-10-01T08:00:00.000Z",
  entryCount: 4,
  rowVersion: 2,
};

describe("periodsResponse", () => {
  // The month-lock dialog asks "is this the current month?" in the workspace's
  // time zone, so the server answers it; the device clock may be wrong (#591).
  it("carries the workspace's current period", () => {
    const parsed = periodsResponse.parse({ periods: [period], currentPeriodCode: "2026-10" });
    expect(parsed.currentPeriodCode).toBe("2026-10");
  });

  it("requires the current period", () => {
    expect(periodsResponse.safeParse({ periods: [period] }).success).toBe(false);
  });

  it("rejects a current period that is not a month code", () => {
    expect(periodsResponse.safeParse({ periods: [], currentPeriodCode: "2026-13" }).success).toBe(false);
    expect(periodsResponse.safeParse({ periods: [], currentPeriodCode: "2026-10-01" }).success).toBe(false);
  });
});
