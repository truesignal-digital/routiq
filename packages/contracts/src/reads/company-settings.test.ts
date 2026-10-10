import { describe, expect, it } from "vitest";
import { companySettingsResponse } from "./company-settings.js";

describe("companySettingsResponse", () => {
  it("carries the summary schedule and its version", () => {
    expect(companySettingsResponse.parse({ summarySchedule: "MONDAY_AND_MONTH_START", version: 0 })).toEqual({
      summarySchedule: "MONDAY_AND_MONTH_START",
      version: 0,
    });
  });

  it("refuses a schedule outside the list and a negative version", () => {
    expect(companySettingsResponse.safeParse({ summarySchedule: "DAILY", version: 1 }).success).toBe(false);
    expect(companySettingsResponse.safeParse({ summarySchedule: "NEVER", version: -1 }).success).toBe(false);
  });
});
