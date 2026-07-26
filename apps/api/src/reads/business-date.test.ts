import { describe, expect, it } from "vitest";
import { addDays, currentBusinessDate, dayWindow } from "./business-date.js";

describe("currentBusinessDate", () => {
  it("resolves the day in the workspace timezone, not the server's", () => {
    // 23:30 UTC is already the next day in Douala (UTC+1).
    const instant = new Date("2026-07-25T23:30:00Z");
    expect(currentBusinessDate(instant, "Africa/Douala")).toBe("2026-07-26");
    expect(currentBusinessDate(instant, "UTC")).toBe("2026-07-25");
  });

  it("pads month and day", () => {
    expect(currentBusinessDate(new Date("2026-01-05T09:00:00Z"), "UTC")).toBe(
      "2026-01-05",
    );
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("is unaffected by a DST transition in the server's local zone", () => {
    // Europe/Paris springs forward on 2026-03-29; local-time math would return
    // the same calendar day twice or skip one.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });
});

describe("dayWindow", () => {
  it("returns the requested number of days, ascending, ending at the given day", () => {
    expect(dayWindow("2026-07-26", 3)).toEqual([
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
  });

  it("keeps its length across a month boundary", () => {
    expect(dayWindow("2026-03-02", 90)).toHaveLength(90);
    expect(dayWindow("2026-03-02", 90).at(-1)).toBe("2026-03-02");
    expect(dayWindow("2026-03-02", 90)[0]).toBe("2025-12-03");
  });
});
