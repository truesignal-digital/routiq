import { describe, expect, it } from "vitest";
import { defaultSheetValues, newEntryRow, type SheetFormValues } from "./form.js";
import { missingInRows, missingRequired, sheetSectionStates, sheetTotals } from "./progress.js";

function sheet(overrides: Partial<SheetFormValues> = {}): SheetFormValues {
  return { ...defaultSheetValues("haulage"), ...overrides };
}

const leg = (from: string, to: string, distanceKm: string) => ({
  legId: `${from}-${to}`,
  origin: { kind: "text" as const, text: from },
  destination: { kind: "text" as const, text: to },
  departedAt: "",
  arrivedAt: "",
  distanceKm,
  passengerCount: "",
  loadState: "" as const,
});

const line = (direction: "REVENUE" | "EXPENSE", amount: string, attributeToActivity = true) => ({
  ...newEntryRow(direction),
  categoryCode: direction === "REVENUE" ? "FREIGHT" : "FUEL",
  amount,
  attributeToActivity,
});

describe("sheet progress", () => {
  it("lists the required fields still empty, in the order the sheet asks for them", () => {
    expect(missingRequired(sheet({ branchCode: "DLA", startedAt: "2026-07-21T07:00" }))).toEqual([
      "activityTypeCode",
      "primaryAssetId",
      "endedAt",
    ]);
  });

  it("says which sections are done, missing something, or not started", () => {
    const states = sheetSectionStates(
      sheet({
        branchCode: "DLA",
        activityTypeCode: "HAUL",
        primaryAssetId: "a1",
        startedAt: "2026-07-21T07:00",
        legs: [leg("Douala", "Bafoussam", "295")],
      }),
    );

    expect(states.references).toEqual({ missing: 0, started: true });
    expect(states.vehicle).toEqual({ missing: 1, started: true });
    expect(states.crew).toEqual({ missing: 0, started: false });
    expect(states.legs).toEqual({ missing: 0, started: true });
    expect(states.money).toEqual({ missing: 0, started: false });
  });

  it("adds up the route, distance, revenue and expenses the sheet gives", () => {
    expect(
      sheetTotals(
        sheet({
          legs: [leg("Douala", "Edéa", "60"), leg("Edéa", "Bafoussam", "235")],
          entries: [line("REVENUE", "450 000"), line("EXPENSE", "86000"), line("EXPENSE", "10000")],
        }),
      ),
    ).toEqual({ from: "Douala", to: "Bafoussam", distanceKm: 295, revenue: 450000, expenses: 96000 });
  });

  it("counts nothing nobody entered and leaves out money kept off the trip", () => {
    expect(
      sheetTotals(sheet({ entries: [line("EXPENSE", "250000", false), line("EXPENSE", "")] })),
    ).toEqual({});
  });
});

describe("half-filled rows", () => {
  it("counts what a started leg or money line still lacks in its section", () => {
    const values = sheet({
      legs: [{ ...leg("Douala", "", "295"), destination: undefined }],
      entries: [line("EXPENSE", "86000"), { ...line("REVENUE", "450000"), categoryCode: "" }, line("EXPENSE", "")],
    });

    expect(missingInRows(values)).toEqual([
      { field: "legs.0.destination", kind: "destination", position: 1 },
      { field: "entries.1.categoryCode", kind: "category", position: 2 },
      { field: "entries.2.amount", kind: "amount", position: 3 },
    ]);
    expect(sheetSectionStates(values).legs.missing).toBe(1);
    expect(sheetSectionStates(values).money.missing).toBe(2);
  });
});
