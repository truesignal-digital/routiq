import { describe, expect, it } from "vitest";
import {
  DAILY_STATUSES,
  FLEET_BOARD_DAYS,
  fleetUsageQuery,
  fleetUsageResponse,
  OFF_ROAD_MONTHS,
  type FleetUsageResponse,
} from "./fleet-usage.js";

const id = "8b7f3a52-2c1e-4c55-9a0e-6f1d2b3c4d5e";
const days = Array.from({ length: FLEET_BOARD_DAYS }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")}`);
const km = { km: 1200, known: true, tripsClosed: 3, tripsFromOdometer: 1, tripsWithoutKm: 0 };
const loadKm = { emptyKm: 200, loadedKm: 800, unknownLoadKm: 0 };
const cost = { costPerKmMinor: 250, expenseMinor: 300_000, km: 1200, vehicles: 1 };

const ledgerBody: FleetUsageResponse = {
  range: "THIS_MONTH",
  branchId: null,
  businessDate: "2026-10-09",
  period: { from: "2026-10-01", to: "2026-10-09" },
  comparison: { from: "2026-09-01", to: "2026-09-09" },
  kmRule: "LEGS_THEN_ODOMETER",
  boardDays: days,
  vehicles: [
    {
      assetId: id,
      assetCode: "VH001",
      registrationNumber: null,
      branchId: id,
      days: days.map((_, i) => DAILY_STATUSES[i % DAILY_STATUSES.length]!),
      period: km,
      comparison: km,
      money: {
        expenseMinor: 300_000,
        fuelExpenseMinor: 200_000,
        costPerKmMinor: 250,
        fuelPerKmMinor: 167,
        fuelAboveMedianPercent: null,
      },
    },
  ],
  km: { period: { vehicles: 1, knownVehicles: 1, knownKm: 1200 }, comparison: { vehicles: 1, knownVehicles: 1, knownKm: 1200 } },
  onTheRoad: {
    last: { tripDays: 6, recordedDays: 24, notRecordedDays: 6 },
    previous: { tripDays: 0, recordedDays: 0, notRecordedDays: 30 },
  },
  offRoadByMonth: Array.from({ length: OFF_ROAD_MONTHS }, (_, i) => ({
    periodCode: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
    days: i,
    partial: i === OFF_ROAD_MONTHS - 1,
  })),
  money: {
    currency: "XAF",
    period: cost,
    comparison: cost,
    costPerKmMedianMinor: 250,
    fuelPerKmMedianMinor: 167,
  },
  trips: {
    period: loadKm,
    comparison: loadKm,
    routes: [
      { key: "douala|yaoundé", from: "Douala", to: "Yaoundé", trips: 3, tripsWithKm: 3, km: 1200, revenueMinor: 900_000, revenuePerKmMinor: 750 },
    ],
    otherRoutes: 0,
    tripsWithoutRoute: 0,
  },
};

/** What a role without vehicle money gets: every money-derived value null. */
const withoutMoney: FleetUsageResponse = {
  ...ledgerBody,
  vehicles: ledgerBody.vehicles.map((vehicle) => ({ ...vehicle, money: null })),
  money: null,
  trips: {
    ...ledgerBody.trips!,
    routes: ledgerBody.trips!.routes.map((route) => ({ ...route, revenueMinor: null, revenuePerKmMinor: null })),
  },
};

describe("fleet usage (#668)", () => {
  it("reads this month unless asked, and narrows by a branch id only", () => {
    expect(fleetUsageQuery.parse({})).toEqual({ range: "THIS_MONTH" });
    expect(fleetUsageQuery.parse({ range: "TWELVE_MONTHS", branchId: id })).toEqual({ range: "TWELVE_MONTHS", branchId: id });
    expect(fleetUsageQuery.safeParse({ branchId: "DLA" }).success).toBe(false);
  });

  it("accepts the body a ledger reader gets, and the one without money", () => {
    expect(fleetUsageResponse.parse(ledgerBody)).toEqual(ledgerBody);
    expect(fleetUsageResponse.parse(withoutMoney)).toEqual(withoutMoney);
  });

  it("never lets a money-derived value through without the money section", () => {
    const leakedVehicle = { ...withoutMoney, vehicles: ledgerBody.vehicles };
    expect(fleetUsageResponse.safeParse(leakedVehicle).success).toBe(false);
    const leakedRoute = { ...withoutMoney, trips: ledgerBody.trips };
    expect(fleetUsageResponse.safeParse(leakedRoute).success).toBe(false);
    const halfMoney = { ...ledgerBody, vehicles: withoutMoney.vehicles };
    expect(fleetUsageResponse.safeParse(halfMoney).success).toBe(false);
  });

  it("draws exactly the board's days and twelve months, and only the five statuses", () => {
    expect(fleetUsageResponse.safeParse({ ...ledgerBody, boardDays: days.slice(1) }).success).toBe(false);
    const badStatus = { ...ledgerBody, vehicles: [{ ...ledgerBody.vehicles[0]!, days: days.map(() => "IDLE") }] };
    expect(fleetUsageResponse.safeParse(badStatus).success).toBe(false);
    expect(fleetUsageResponse.safeParse({ ...ledgerBody, offRoadByMonth: ledgerBody.offRoadByMonth!.slice(1) }).success).toBe(false);
  });

  it("names its km rule and never takes a negative km", () => {
    expect(fleetUsageResponse.safeParse({ ...ledgerBody, kmRule: "ODOMETER_FIRST" }).success).toBe(false);
    const negative = { ...ledgerBody, vehicles: [{ ...ledgerBody.vehicles[0]!, period: { ...km, km: -5 } }] };
    expect(fleetUsageResponse.safeParse(negative).success).toBe(false);
  });
});
