import { describe, expect, it } from "vitest";
import { activeDashboardTab, dashboardTabSearch, rangeFromParam } from "./tabs.js";

describe("dashboard tabs", () => {
  it("reads the tab from the address, Overview by default", () => {
    expect(activeDashboardTab("/")).toBe("overview");
    expect(activeDashboardTab("/to-do")).toBe("todo");
    expect(activeDashboardTab("/profit-by-vehicle")).toBe("vehicles");
    expect(activeDashboardTab("/profit-by-branch")).toBe("branches");
  });

  it("keeps the range on the money tabs and drops it on To do", () => {
    expect(dashboardTabSearch("vehicles", "3-months")).toEqual({ range: "3-months" });
    expect(dashboardTabSearch("overview", undefined)).toEqual({});
    expect(dashboardTabSearch("todo", "12-months")).toEqual({});
  });

  it("maps the address's range to the read's", () => {
    expect(rangeFromParam(undefined)).toBe("THIS_MONTH");
    expect(rangeFromParam("3-months")).toBe("THREE_MONTHS");
    expect(rangeFromParam("12-months")).toBe("TWELVE_MONTHS");
  });
});
