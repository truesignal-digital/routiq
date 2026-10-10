import { describe, expect, it } from "vitest";
import { ROLES } from "@routiq/contracts";
import { roleLanding } from "./landing.js";

const ALL = ["CORE", "ASSETS", "DOCUMENTS", "FINANCE", "ACTIVITIES", "MAINTENANCE"] as const;

describe("roleLanding (#665, dashboards.html#roles)", () => {
  it("opens the technician on the Maintenance Overview", () => {
    expect(roleLanding("TECHNICIAN", [...ALL])).toBe("/maintenance");
  });

  it("keeps the technician on Home while Maintenance is off: the page is not there", () => {
    expect(roleLanding("TECHNICIAN", ALL.filter((code) => code !== "MAINTENANCE"))).toBe("/");
  });

  it("opens every other role on Home", () => {
    for (const role of ROLES.filter((candidate) => candidate !== "TECHNICIAN")) {
      expect(roleLanding(role, [...ALL]), role).toBe("/");
    }
    expect(roleLanding(undefined, [...ALL])).toBe("/");
  });
});
