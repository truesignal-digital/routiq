import type { DailyStatus, FleetUsageResponse, FleetUsageVehicle } from "@routiq/contracts";

/** September 10 to October 9, today last. */
const BOARD_DAYS = Array.from({ length: 30 }, (_unused, index) =>
  index < 21 ? `2026-09-${String(10 + index).padStart(2, "0")}` : `2026-10-${String(index - 20).padStart(2, "0")}`,
);

const run = (status: DailyStatus, count: number): DailyStatus[] => Array.from({ length: count }, () => status);

function vehicle(
  assetId: string,
  assetCode: string,
  days: DailyStatus[],
  km: number,
  known: boolean,
  fuelExpenseMinor: number,
  fuelPerKmMinor: number | null,
  fuelAboveMedianPercent: number | null,
): FleetUsageVehicle {
  const vehicleKm = { km, known, tripsClosed: 3, tripsFromOdometer: 0, tripsWithoutKm: known ? 0 : 1 };
  return {
    assetId,
    assetCode,
    registrationNumber: null,
    branchId: "b1",
    days,
    period: vehicleKm,
    comparison: vehicleKm,
    money: {
      expenseMinor: fuelExpenseMinor * 2,
      fuelExpenseMinor,
      costPerKmMinor: fuelPerKmMinor === null ? null : fuelPerKmMinor * 2,
      fuelPerKmMinor,
      fuelAboveMedianPercent,
    },
  };
}

/**
 * A usage read for tests, priced like dashboards.html: October 1–9 against
 * September 1–9, VH007 the fuel outlier, VH012 with a trip that has no km.
 */
export function testUsage(): FleetUsageResponse {
  return {
    range: "THIS_MONTH",
    branchId: null,
    businessDate: "2026-10-09",
    period: { from: "2026-10-01", to: "2026-10-09" },
    comparison: { from: "2026-09-01", to: "2026-09-09" },
    kmRule: "LEGS_THEN_ODOMETER",
    boardDays: BOARD_DAYS,
    vehicles: [
      vehicle("a1", "VH001", [...run("ON_TRIP", 20), ...run("AVAILABLE", 10)], 1500, true, 435_000, 290, null),
      vehicle("a3", "VH003", [...run("ON_TRIP", 18), ...run("WORKSHOP", 10), ...run("GROUNDED", 2)], 1000, true, 300_000, 300, null),
      vehicle("a7", "VH007", [...run("ON_TRIP", 25), ...run("AVAILABLE", 5)], 1500, true, 540_000, 360, 24),
      vehicle("a12", "VH012", [...run("NOT_RECORDED", 10), ...run("AVAILABLE", 20)], 400, false, 120_000, null, null),
    ],
    km: {
      period: { vehicles: 4, knownVehicles: 3, knownKm: 4000 },
      comparison: { vehicles: 4, knownVehicles: 4, knownKm: 4200 },
    },
    onTheRoad: {
      last: { tripDays: 63, recordedDays: 110, notRecordedDays: 10 },
      previous: { tripDays: 74, recordedDays: 110, notRecordedDays: 10 },
    },
    offRoadByMonth: Array.from({ length: 12 }, (_unused, index) => {
      const month = index + 11;
      const periodCode = month > 12 ? `2026-${String(month - 12).padStart(2, "0")}` : `2025-${String(month).padStart(2, "0")}`;
      return { periodCode, days: index === 11 ? 12 : 8 + index, partial: index === 11 };
    }),
    money: {
      currency: "XAF",
      period: { costPerKmMinor: 498, expenseMinor: 1_992_000, km: 4000, vehicles: 3 },
      comparison: { costPerKmMinor: 479, expenseMinor: 2_011_800, km: 4200, vehicles: 4 },
      costPerKmMedianMinor: 600,
      fuelPerKmMedianMinor: 300,
    },
    trips: {
      period: { emptyKm: 720, loadedKm: 3280, unknownLoadKm: 150 },
      comparison: { emptyKm: 630, loadedKm: 3570, unknownLoadKm: 0 },
      routes: [
        { key: "dla-yde", from: "Douala", to: "Yaoundé", trips: 11, tripsWithKm: 11, km: 2700, revenueMinor: 1_944_000, revenuePerKmMinor: 720 },
        { key: "bfs-dla", from: "Bafoussam", to: "Douala", trips: 7, tripsWithKm: 6, km: 1800, revenueMinor: 1_242_000, revenuePerKmMinor: 690 },
        { key: "dla-kri", from: "Douala", to: "Kribi", trips: 1, tripsWithKm: 0, km: 0, revenueMinor: 0, revenuePerKmMinor: null },
      ],
      otherRoutes: 2,
      tripsWithoutRoute: 1,
    },
  };
}
