import { describe, expect, it } from "vitest";
import {
  ACTIVITY_OVERVIEW_WEEKS,
  activityFinancialEntryRead,
  activityListQuery,
  activitySummary,
} from "./activities.js";

const fuelEntry = {
  entryId: "06e0dc72-13c7-466d-a7c2-d33e1fb9d756",
  entryNumber: "DLA-2026-00008",
  direction: "EXPENSE",
  categoryCode: "FUEL",
  categoryLabelFr: "Carburant",
  categoryLabelEn: "Fuel",
  amountMinor: 86_000,
  status: "POSTED",
  reversesEntryId: null,
  cancelledBy: null,
};

describe("activity financial entry read", () => {
  it("carries the category's labels beside its code (#129)", () => {
    expect(activityFinancialEntryRead.parse(fuelEntry)).toEqual(fuelEntry);
  });

  it("refuses an entry without labels, which would leave the screen only the code", () => {
    const { categoryLabelFr: _fr, categoryLabelEn: _en, ...codeOnly } = fuelEntry;
    expect(activityFinancialEntryRead.safeParse(codeOnly).success).toBe(false);
  });
});

describe("activity summary contract", () => {
  const weeks = Array.from({ length: ACTIVITY_OVERVIEW_WEEKS }, (_, index) => ({
    from: `2026-${String(7 + Math.floor(index / 4)).padStart(2, "0")}-0${1 + (index % 4)}`,
    to: `2026-${String(7 + Math.floor(index / 4)).padStart(2, "0")}-1${1 + (index % 4)}`,
    started: index,
    closed: 0,
  }));
  const summary = {
    week: { from: "2026-10-05", to: "2026-10-11" },
    thisWeek: 3,
    weekClosed: 2,
    open: 2,
    oldestOpen: {
      id: "06e0dc72-13c7-466d-a7c2-d33e1fb9d756",
      activityNumber: "DLA-2026-00003",
      startedAt: "2026-10-07T06:00:00.000Z",
      assetCode: null,
    },
    incomplete: 0,
    closedMissing: { fuel: 3, km: 2 },
    weekKm: null,
    weeks,
    notice: { today: "2026-10-09", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] },
  };

  it("accepts the overview, with fuel withheld while Money is off", () => {
    expect(activitySummary.parse(summary)).toEqual(summary);
    const off = { ...summary, oldestOpen: null, closedMissing: { fuel: null, km: 2 } };
    expect(activitySummary.parse(off)).toEqual(off);
  });

  it("refuses a chart that is not exactly twelve weeks", () => {
    expect(activitySummary.safeParse({ ...summary, weeks: weeks.slice(1) }).success).toBe(false);
  });
});

describe("activity list query contract", () => {
  it("accepts the missing filters and refuses any other", () => {
    expect(activityListQuery.parse({ missing: "fuel" }).missing).toBe("fuel");
    expect(activityListQuery.parse({ missing: "km", status: "CLOSED" })).toMatchObject({
      missing: "km",
      status: "CLOSED",
    });
    expect(activityListQuery.safeParse({ missing: "tyres" }).success).toBe(false);
  });
});
