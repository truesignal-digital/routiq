import { describe, expect, it } from "vitest";
import { activeTripsTab, visibleTripsTabs } from "./tripsTabs.js";

const WITH_SCHEDULING = ["CORE", "ASSETS", "ACTIVITIES", "SCHEDULING"] as const;

describe("the Trips page's tabs (#665)", () => {
  it("shows Planning only while Scheduling is on", () => {
    expect(visibleTripsTabs("ADMIN", [...WITH_SCHEDULING])).toEqual(["overview", "list", "planning"]);
    expect(visibleTripsTabs("ADMIN", ["CORE", "ASSETS", "ACTIVITIES"])).toEqual(["overview", "list"]);
  });

  it("keeps Planning for the planners: a driver has no planning board", () => {
    expect(visibleTripsTabs("DRIVER", [...WITH_SCHEDULING])).toEqual(["overview", "list"]);
  });

  it("reads the tab from the address", () => {
    expect(activeTripsTab("/activities")).toBe("overview");
    expect(activeTripsTab("/activities/list")).toBe("list");
    expect(activeTripsTab("/activities/planning")).toBe("planning");
  });
});
