import { describe, expect, it } from "vitest";
import { workspaceMonth, workspaceToday } from "./workspace-day.js";

// #639: "today" and "this month" are the workspace's, whatever the device says.
describe("the workspace's day", () => {
  it("cuts the day at the workspace's midnight, not the device's", () => {
    // 23:30 UTC on 30 September is already 1 October in Douala (UTC+1).
    const lateSeptemberUtc = new Date("2026-09-30T23:30:00Z");
    expect(workspaceToday("Africa/Douala", lateSeptemberUtc)).toBe("2026-10-01");
    expect(workspaceMonth("Africa/Douala", lateSeptemberUtc)).toBe("2026-10");
    expect(workspaceToday("UTC", lateSeptemberUtc)).toBe("2026-09-30");
    expect(workspaceMonth("UTC", lateSeptemberUtc)).toBe("2026-09");
  });

  it("crosses a year boundary", () => {
    expect(workspaceToday("Pacific/Kiritimati", new Date("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
  });
});
