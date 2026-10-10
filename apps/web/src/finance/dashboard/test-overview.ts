import type { FinanceOverviewResponse } from "@routiq/contracts";

/**
 * A money read for tests, priced like dashboards.html#home: October 1–9
 * against September 1–9, profit 1 970 000 → 1 870 000. Every part adds up the
 * way the server's do: categories to expenses, vehicles plus company costs to
 * expenses, vehicle profit minus company costs to company profit.
 */
export const DLA = "aaaaaaaa-0000-4000-8000-000000000001";
export const YDE = "aaaaaaaa-0000-4000-8000-000000000002";

const category = (
  code: string,
  labelEn: string,
  labelFr: string,
  period: number,
  comparison: number,
  company = false,
) => ({
  code,
  labelEn,
  labelFr,
  layer: null,
  period: { expenseMinor: period, companyCostMinor: company ? period : 0 },
  comparison: { expenseMinor: comparison, companyCostMinor: company ? comparison : 0 },
});

export function testOverview(overrides: Partial<FinanceOverviewResponse> = {}): FinanceOverviewResponse {
  return {
    currency: "XAF",
    range: "THIS_MONTH",
    branchId: null,
    view: "PROFIT",
    period: { from: "2026-10-01", to: "2026-10-09", revenueMinor: 9_560_000, expenseMinor: 7_690_000, profitMinor: 1_870_000 },
    comparison: { from: "2026-09-01", to: "2026-09-09", revenueMinor: 8_900_000, expenseMinor: 6_930_000, profitMinor: 1_970_000 },
    series: Array.from({ length: 12 }, (_, index) => ({
      periodCode: `${index < 3 ? 2025 : 2026}-${String(((index + 9) % 12) + 1).padStart(2, "0")}`,
      revenueMinor: 20_000_000 + index * 100_000,
      expenseMinor: 17_000_000 + index * 50_000,
    })),
    expensesByCategory: [
      category("FUEL", "Fuel", "Carburant", 3_000_000, 2_580_000),
      category("REPAIRS", "Repairs", "Réparations", 1_200_000, 840_000),
      category("TOLLS", "Tolls and checkpoints", "Péages et contrôles", 400_000, 360_000),
      category("OTHER", "Other vehicle costs", "Autres coûts véhicule", 2_450_000, 2_550_000),
      category("OFFICE", "Office rent", "Loyer du bureau", 640_000, 600_000, true),
    ],
    vehicles: [
      {
        assetId: "bbbbbbbb-0000-4000-8000-000000000003",
        assetCode: "VH003",
        registrationNumber: "LT 003 AA",
        branchId: DLA,
        tripsClosed: 0,
        distanceKm: null,
        tripsWithoutKm: 0,
        revenueMinor: 0,
        expenseMinor: 420_000,
        profitMinor: -420_000,
      },
      {
        assetId: "bbbbbbbb-0000-4000-8000-000000000002",
        assetCode: "VH002",
        registrationNumber: null,
        branchId: YDE,
        tripsClosed: 12,
        distanceKm: 4_800,
        tripsWithoutKm: 1,
        revenueMinor: 5_560_000,
        expenseMinor: 4_130_000,
        profitMinor: 1_430_000,
      },
      {
        assetId: "bbbbbbbb-0000-4000-8000-000000000001",
        assetCode: "VH001",
        registrationNumber: "LT 001 AA",
        branchId: DLA,
        tripsClosed: 15,
        distanceKm: 5_100,
        tripsWithoutKm: 0,
        revenueMinor: 4_000_000,
        expenseMinor: 2_500_000,
        profitMinor: 1_500_000,
      },
    ],
    branches: [
      { branchId: DLA, code: "DLA", name: "Douala", vehicleCount: 2, revenueMinor: 4_000_000, expenseMinor: 2_920_000, vehicleProfitMinor: 1_080_000 },
      { branchId: YDE, code: "YDE", name: "Yaoundé", vehicleCount: 1, revenueMinor: 5_560_000, expenseMinor: 4_130_000, vehicleProfitMinor: 1_430_000 },
    ],
    companyProfit: {
      period: { vehicleProfitMinor: 2_510_000, revenueWithoutVehicleMinor: 0, companyCostsMinor: 640_000, companyProfitMinor: 1_870_000 },
      comparison: { vehicleProfitMinor: 2_570_000, revenueWithoutVehicleMinor: 0, companyCostsMinor: 600_000, companyProfitMinor: 1_970_000 },
    },
    counted: { postedEntries: 84, closedTrips: 27 },
    notCounted: {
      waitingApproval: { count: 6, amountMinor: 1_140_000 },
      missingReceipt: { count: 4, amountMinor: 210_000 },
      openTrips: 5,
      otherCurrencyEntries: 0,
    },
    summary: {
      template: "BEHIND",
      measure: "PROFIT",
      window: "MONTH_SO_FAR",
      period: { from: "2026-10-01", to: "2026-10-09" },
      comparison: { from: "2026-09-01", to: "2026-09-09" },
      currentMinor: 1_870_000,
      comparisonMinor: 1_970_000,
      revenueMinor: 9_560_000,
      changePercent: 5,
      reason: { kind: "CATEGORY", category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" }, changeMinor: 420_000 },
      shortOf: null,
      trips: { closed: 27, open: 5 },
    },
    // A Friday with nothing big: the summary is not due.
    notice: { today: "2026-10-09", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] },
    ...overrides,
  };
}

/** An internal fleet: the same expenses and no revenue anywhere. */
export function internalFleetOverview(): FinanceOverviewResponse {
  const base = testOverview();
  return testOverview({
    period: { ...base.period, revenueMinor: 0, profitMinor: -7_690_000 },
    comparison: { ...base.comparison, revenueMinor: 0, profitMinor: -6_930_000 },
    series: base.series.map((month) => ({ ...month, revenueMinor: 0 })),
    vehicles: (base.vehicles ?? []).map((row) => ({ ...row, revenueMinor: 0, profitMinor: -row.expenseMinor })),
    branches: (base.branches ?? []).map((row) => ({ ...row, revenueMinor: 0, vehicleProfitMinor: -row.expenseMinor })),
    companyProfit: {
      period: { vehicleProfitMinor: -7_050_000, revenueWithoutVehicleMinor: 0, companyCostsMinor: 640_000, companyProfitMinor: -7_690_000 },
      comparison: { vehicleProfitMinor: -6_330_000, revenueWithoutVehicleMinor: 0, companyCostsMinor: 600_000, companyProfitMinor: -6_930_000 },
    },
  });
}
