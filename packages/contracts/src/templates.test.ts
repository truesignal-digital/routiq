import { describe, expect, it } from "vitest";
import { templateFieldIssues } from "./templates.js";

describe("templateFieldIssues", () => {
  it("accepts valid TRUCKING values", () => {
    expect(
      templateFieldIssues("TRUCKING", { axleCount: 3, bodyType: "flatbed" }),
    ).toEqual([]);
  });

  it("flags missing required seatCount for PASSENGER_TRANSPORT", () => {
    expect(templateFieldIssues("PASSENGER_TRANSPORT", {})).toEqual([
      { key: "seatCount", kind: "required" },
    ]);
  });

  it("flags wrong types and unknown keys", () => {
    expect(
      templateFieldIssues("TRUCKING", { axleCount: "three", spoilers: true }),
    ).toEqual([
      { key: "axleCount", kind: "wrongType", expected: "number" },
      { key: "spoilers", kind: "unknown" },
    ]);
  });

  it("ignores empty (undefined) optional values", () => {
    expect(templateFieldIssues("TRUCKING", { bodyType: undefined })).toEqual([]);
  });

  it("unknown template yields no client issues (server decides)", () => {
    expect(templateFieldIssues("HOVERCRAFT", { x: 1 })).toEqual([]);
  });
});
