import { describe, expect, it } from "vitest";
import { ROLES } from "../roles.js";
import { navCountsResponse, waitsOn } from "./nav-counts.js";

describe("navigation counts", () => {
  it("wait on the approvers for Money and on the workshop for Maintenance", () => {
    expect(ROLES.filter((role) => waitsOn("moneyWaiting", role))).toEqual(["DIRECTOR", "FINANCE"]);
    expect(ROLES.filter((role) => waitsOn("maintenanceNew", role)).sort()).toEqual([
      "ADMIN",
      "DIRECTOR",
      "TECHNICIAN",
    ]);
  });

  it("keep null (no count) apart from zero", () => {
    expect(navCountsResponse.parse({ moneyWaiting: null, maintenanceNew: 0 })).toEqual({
      moneyWaiting: null,
      maintenanceNew: 0,
    });
    expect(navCountsResponse.safeParse({ moneyWaiting: -1, maintenanceNew: null }).success).toBe(false);
  });
});
