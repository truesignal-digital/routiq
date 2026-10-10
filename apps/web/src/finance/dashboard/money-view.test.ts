import { describe, expect, it } from "vitest";
import { companyLines, dashboardMode, vehicleRows, vehiclesAtALoss } from "./money-view.js";
import { DLA, internalFleetOverview, testOverview } from "./test-overview.js";

describe("dashboardMode", () => {
  it("shows profit to a company that records revenue", () => {
    expect(dashboardMode(testOverview())).toBe("profit");
  });

  it("shows costs, never a profit, to a company that records no revenue (internal fleet)", () => {
    expect(dashboardMode(internalFleetOverview())).toBe("costs");
  });

  it("keeps profit through a quiet month when the year had revenue", () => {
    const base = testOverview();
    const quiet = testOverview({
      period: { ...base.period, revenueMinor: 0, profitMinor: -base.period.expenseMinor },
      comparison: { ...base.comparison, revenueMinor: 0, profitMinor: -base.comparison.expenseMinor },
    });
    expect(dashboardMode(quiet)).toBe("profit");
  });
});

describe("vehicleRows", () => {
  it("lists every vehicle for all branches, and only the chosen branch's otherwise", () => {
    expect(vehicleRows(testOverview(), undefined).map((row) => row.assetCode)).toEqual(["VH003", "VH002", "VH001"]);
    expect(vehicleRows(testOverview(), DLA).map((row) => row.assetCode)).toEqual(["VH003", "VH001"]);
  });
});

describe("companyLines", () => {
  it("adds all vehicles' profit and company costs up to company profit", () => {
    const overview = testOverview();
    const lines = companyLines(overview, vehicleRows(overview, undefined));
    expect(lines).toMatchObject({
      shownVehicleCount: 3,
      shownVehicleProfitMinor: 2_510_000,
      otherVehicleProfitMinor: 0,
      companyCostsMinor: 640_000,
      companyProfitMinor: 1_870_000,
    });
    if (lines === undefined) return;
    expect(
      lines.shownVehicleProfitMinor + lines.otherVehicleProfitMinor + lines.revenueWithoutVehicleMinor - lines.companyCostsMinor,
    ).toBe(lines.companyProfitMinor);
  });

  it("names the vehicles a branch filter left off, so the lines still add up", () => {
    const overview = testOverview();
    const lines = companyLines(overview, vehicleRows(overview, DLA));
    expect(lines?.shownVehicleProfitMinor).toBe(1_080_000);
    expect(lines?.otherVehicleProfitMinor).toBe(1_430_000);
    expect(lines?.otherVehicleExpenseMinor).toBe(4_130_000);
  });
});

describe("vehiclesAtALoss", () => {
  it("keeps the worst three losses, worst first, and no vehicle in profit", () => {
    const base = testOverview();
    const rows = [
      ...(base.vehicles ?? []),
      ...[-10, -500_000, -90_000].map((profitMinor, index) => ({
        ...(base.vehicles ?? [])[0]!,
        assetId: `loss-${index}`,
        assetCode: `VL${index}`,
        profitMinor,
      })),
    ];
    expect(vehiclesAtALoss(rows).map((row) => row.assetCode)).toEqual(["VL1", "VH003", "VL2"]);
  });
});
