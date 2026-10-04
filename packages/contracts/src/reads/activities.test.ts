import { describe, expect, it } from "vitest";
import { activityFinancialEntryRead } from "./activities.js";

const fuelEntry = {
  entryId: "06e0dc72-13c7-466d-a7c2-d33e1fb9d756",
  entryNumber: "DLA-2026-00008",
  direction: "EXPENSE",
  categoryCode: "FUEL",
  categoryLabelFr: "Carburant",
  categoryLabelEn: "Fuel",
  amountMinor: 86_000,
  status: "POSTED",
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
