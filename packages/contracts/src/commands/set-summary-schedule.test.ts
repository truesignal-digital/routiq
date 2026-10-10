import { describe, expect, it } from "vitest";
import { DEFAULT_SUMMARY_SCHEDULE, SUMMARY_SCHEDULES, setSummaryScheduleCommand } from "./set-summary-schedule.js";

const command = {
  name: "set-summary-schedule",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "set-summary-schedule-1",
    origin: "HUMAN_UI",
    sourceArtifactIds: [],
    expectedVersion: 0,
  },
  payload: { schedule: "MONDAY" },
};

describe("setSummaryScheduleCommand", () => {
  it("accepts each of the four schedules", () => {
    for (const schedule of SUMMARY_SCHEDULES) {
      expect(setSummaryScheduleCommand.parse({ ...command, payload: { schedule } }).payload.schedule).toBe(schedule);
    }
  });

  it("defaults to every Monday and the 1st", () => {
    expect(DEFAULT_SUMMARY_SCHEDULE).toBe("MONDAY_AND_MONTH_START");
    expect(SUMMARY_SCHEDULES).toEqual(["MONDAY_AND_MONTH_START", "MONDAY", "MONTH_START", "NEVER"]);
  });

  it("refuses a schedule outside the list", () => {
    expect(setSummaryScheduleCommand.safeParse({ ...command, payload: { schedule: "DAILY" } }).success).toBe(false);
  });

  it("refuses a missing schedule and an unknown key", () => {
    expect(setSummaryScheduleCommand.safeParse({ ...command, payload: {} }).success).toBe(false);
    expect(
      setSummaryScheduleCommand.safeParse({ ...command, payload: { schedule: "MONDAY", workspaceId: "x" } }).success,
    ).toBe(false);
  });
});
