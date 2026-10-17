import { describe, expect, it } from "vitest";
import { activeTrucksTab, visibleTrucksTabs } from "./trucksTabs.js";

const WITH_DOCUMENTS = ["CORE", "ASSETS", "DOCUMENTS"] as const;

describe("the Trucks page's tabs (#665)", () => {
  it("opens on Overview, then the list, then Documents", () => {
    expect(visibleTrucksTabs("ADMIN", [...WITH_DOCUMENTS])).toEqual(["overview", "list", "documents"]);
  });

  it("hides Documents while the Documents module is off", () => {
    expect(visibleTrucksTabs("ADMIN", ["CORE", "ASSETS"])).toEqual(["overview", "list"]);
  });

  it("hides Documents from the roles the fleet's Coming up does not serve", () => {
    expect(visibleTrucksTabs("CASHIER", [...WITH_DOCUMENTS])).toEqual(["overview", "list"]);
    expect(visibleTrucksTabs("DRIVER", [...WITH_DOCUMENTS])).toEqual(["overview", "list"]);
    expect(visibleTrucksTabs("TECHNICIAN", [...WITH_DOCUMENTS])).toEqual(["overview", "list", "documents"]);
  });

  it("reads the tab from the address", () => {
    expect(activeTrucksTab("/assets")).toBe("overview");
    expect(activeTrucksTab("/assets/list")).toBe("list");
    expect(activeTrucksTab("/assets/documents")).toBe("documents");
  });
});
