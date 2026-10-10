import { randomUUID } from "node:crypto";
import { fleetUsageResponse, todoResponse, type FleetUsageResponse } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";
import { currentBusinessDate } from "./business-date.js";
import { judgeDays, median, percentAbove, perKm } from "./fleet-usage.js";

/**
 * Km and daily status (#668). The fleet (DLA unless noted, all commissioned
 * today but VH007), each with one trip closed a moment ago:
 * - VH001: legs Douala → Yaoundé 300 km laden, back 300 km empty; fuel
 *   90 000; revenue 600 000 on the trip. 600 km from legs.
 * - VH002: no legs; odometer 10 000 → 10 400, the end corrected to 10 500.
 *   500 km from the odometer; fuel 60 000.
 * - VH003: one leg Douala → Edéa, 200 km, load not said; fuel 60 000. The
 *   fuel outlier: 300 per km against a median of 150.
 * - VH004: no legs, no readings: km not known; fuel 50 000.
 * - VH005 (YDE): grounded by a safety problem. VH006: an approved work order.
 * - VH007: registered, never commissioned.
 */
describe("GET /v1/assets/usage", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let yaoundeId: string;
  const actors = {} as Record<"DIRECTOR" | "FINANCE" | "ADMIN" | "CASHIER" | "TECHNICIAN" | "DRIVER", Actor>;
  const asset: Record<string, string> = {};
  const trip: Record<string, string> = {};
  const today = currentBusinessDate(new Date(), "Africa/Douala");

  async function usage(actor: Actor, query = ""): Promise<FleetUsageResponse> {
    const reply = await api.get(actor.token, `/v1/assets/usage${query}`);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    return fleetUsageResponse.parse(reply.body);
  }

  const vehicle = (body: FleetUsageResponse, code: string) => {
    const found = body.vehicles.find((row) => row.assetCode === code);
    if (found === undefined) throw new Error(`${code} not listed`);
    return found;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db.insert(branches).values({ workspaceId, code: "YDE", name: "Yaoundé" }).returning();
    yaoundeId = yaounde!.id;
    actors.DIRECTOR = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    actors.FINANCE = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    for (const role of ["ADMIN", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      actors[role] = await seedActor(ctx.db, { workspaceId, role, branchIds: [seeded.branch.id] });
    }
    const director = actors.DIRECTOR;

    for (const [code, branchCode] of [
      ["VH001", "DLA"],
      ["VH002", "DLA"],
      ["VH003", "DLA"],
      ["VH004", "DLA"],
      ["VH005", "YDE"],
      ["VH006", "DLA"],
      ["VH007", "DLA"],
    ] as const) {
      const assetId = randomUUID();
      await api.ok(director.token, "register-asset", {
        assetId,
        assetCode: code,
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode,
      });
      asset[code] = assetId;
      if (code !== "VH007") await api.ok(director.token, "commission-asset", { assetId }, { expectedVersion: 1 });
    }

    // Moments ago, so the trips sit on today whatever the hour.
    const now = Date.now();
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    const readings: Record<string, string> = {};
    const sheet = async (
      code: string,
      legs: { from: string; to: string; km?: number; load?: "LADEN" | "EMPTY" }[],
      odometer?: [number, number],
    ) => {
      const activityId = randomUUID();
      if (odometer !== undefined) readings[code] = randomUUID();
      await api.ok(director.token, "record-haulage-job-sheet", {
        activityId,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        primarySegmentId: randomUUID(),
        primaryAssetId: asset[code],
        startedAt: at(60_000),
        endedAt: at(30_000),
        ...(odometer === undefined
          ? {}
          : {
              startReading: { readingId: randomUUID(), readingType: "ODOMETER", value: odometer[0], observedAt: at(60_000) },
              endReading: { readingId: readings[code], readingType: "ODOMETER", value: odometer[1], observedAt: at(30_000) },
            }),
        legs: legs.map((leg, i) => ({
          legId: randomUUID(),
          legNo: i + 1,
          origin: { kind: "text", text: leg.from },
          destination: { kind: "text", text: leg.to },
          ...(leg.km === undefined ? {} : { distanceKm: leg.km }),
          ...(leg.load === undefined ? {} : { loadState: leg.load }),
        })),
        close: true,
      });
      trip[code] = activityId;
    };
    await sheet("VH001", [
      { from: "Douala", to: "Yaoundé", km: 300, load: "LADEN" },
      { from: "Yaoundé", to: "Douala", km: 300, load: "EMPTY" },
    ]);
    await sheet("VH002", [], [10_000, 10_400]);
    await sheet("VH003", [{ from: "Douala", to: "Edéa", km: 200 }]);
    await sheet("VH004", []);
    // The end reading was mis-keyed: the correction supersedes it.
    await api.ok(director.token, "record-meter-reading", {
      readingId: randomUUID(),
      assetId: asset.VH002,
      readingType: "ODOMETER",
      value: 10_500,
      observedAt: at(20_000),
      supersedesReadingId: readings.VH002,
      supersedeReason: "Mauvais chiffre",
    });

    const money = async (direction: "EXPENSE" | "REVENUE", code: string, amountMinor: number, activityId?: string) =>
      api.ok(director.token, direction === "EXPENSE" ? "record-expense" : "record-revenue", {
        entryId: randomUUID(),
        branchCode: "DLA",
        categoryCode: direction === "EXPENSE" ? "FUEL" : "FREIGHT_REVENUE",
        economicDate: today,
        amountMinor,
        paymentMethod: "CASH",
        postings: [{ assetId: asset[code], ...(activityId === undefined ? {} : { activityId }), amountMinor }],
      });
    await money("EXPENSE", "VH001", 90_000);
    await money("REVENUE", "VH001", 600_000, trip.VH001);
    await money("EXPENSE", "VH002", 60_000);
    await money("EXPENSE", "VH003", 60_000);
    await money("EXPENSE", "VH004", 50_000);

    await api.ok(director.token, "report-issue", {
      issueId: randomUUID(),
      assetId: asset.VH005,
      description: "Freins",
      safetyCritical: true,
    });
    await api.ok(actors.TECHNICIAN.token, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: asset.VH006,
      description: "Vidange",
      expectedCostMinor: 0,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("counts km from legs, else the corrected odometer, and says whose km are not known", async () => {
    const body = await usage(actors.DIRECTOR);
    expect(body.kmRule).toBe("LEGS_THEN_ODOMETER");
    expect(vehicle(body, "VH001").period).toEqual({ km: 600, known: true, tripsClosed: 1, tripsFromOdometer: 0, tripsWithoutKm: 0 });
    expect(vehicle(body, "VH002").period).toEqual({ km: 500, known: true, tripsClosed: 1, tripsFromOdometer: 1, tripsWithoutKm: 0 });
    expect(vehicle(body, "VH003").period?.km).toBe(200);
    expect(vehicle(body, "VH004").period).toEqual({ km: 0, known: false, tripsClosed: 1, tripsFromOdometer: 0, tripsWithoutKm: 1 });
    // No trip closed: 0 km, known.
    expect(vehicle(body, "VH006").period).toEqual({ km: 0, known: true, tripsClosed: 0, tripsFromOdometer: 0, tripsWithoutKm: 0 });
    expect(body.km?.period).toEqual({ vehicles: 7, knownVehicles: 6, knownKm: 1300 });
    expect(body.km?.comparison).toEqual({ vehicles: 7, knownVehicles: 7, knownKm: 0 });
  });

  it("divides each vehicle's expenses by its known km, with the fleet medians, and flags fuel above them", async () => {
    const body = await usage(actors.DIRECTOR);
    expect(vehicle(body, "VH001").money).toEqual({
      expenseMinor: 90_000,
      fuelExpenseMinor: 90_000,
      costPerKmMinor: 150,
      fuelPerKmMinor: 150,
      fuelAboveMedianPercent: null,
    });
    expect(vehicle(body, "VH002").money?.fuelPerKmMinor).toBe(120);
    expect(vehicle(body, "VH003").money).toMatchObject({ fuelPerKmMinor: 300, fuelAboveMedianPercent: 100 });
    // Km not known: no per-km figure, never one over the km that are.
    expect(vehicle(body, "VH004").money).toMatchObject({ expenseMinor: 50_000, costPerKmMinor: null, fuelPerKmMinor: null });
    // Nothing recorded: no figure, not 0 per km.
    expect(vehicle(body, "VH006").money).toMatchObject({ expenseMinor: 0, costPerKmMinor: null, fuelPerKmMinor: null });
    expect(body.money).toEqual({
      currency: "XAF",
      period: { costPerKmMinor: 162, expenseMinor: 210_000, km: 1300, vehicles: 3 },
      comparison: { costPerKmMinor: null, expenseMinor: 0, km: 0, vehicles: 0 },
      costPerKmMedianMinor: 150,
      fuelPerKmMedianMinor: 150,
    });
  });

  it("judges each day from grounding, work orders and trips, and the share on the road from it", async () => {
    const body = await usage(actors.DIRECTOR);
    expect(body.boardDays.at(-1)).toBe(today);
    const todayOf = (code: string) => vehicle(body, code).days.at(-1);
    expect(["VH001", "VH002", "VH003", "VH004"].map(todayOf)).toEqual(["ON_TRIP", "ON_TRIP", "ON_TRIP", "ON_TRIP"]);
    expect(todayOf("VH005")).toBe("GROUNDED");
    expect(todayOf("VH006")).toBe("WORKSHOP");
    expect(todayOf("VH007")).toBe("NOT_RECORDED");
    // Before they were commissioned nothing can tell.
    expect(new Set(body.vehicles.flatMap((row) => row.days.slice(0, -1)))).toEqual(new Set(["NOT_RECORDED"]));
    expect(body.onTheRoad.last).toEqual({ tripDays: 4, recordedDays: 6, notRecordedDays: 7 * 30 - 6 });
    expect(body.onTheRoad.previous).toEqual({ tripDays: 0, recordedDays: 0, notRecordedDays: 7 * 30 });
    expect(body.offRoadByMonth).toHaveLength(12);
    expect(body.offRoadByMonth?.at(-1)).toEqual({ periodCode: today.slice(0, 7), days: 2, partial: true });
    expect(body.offRoadByMonth?.slice(0, -1).every((month) => month.days === 0 && !month.partial)).toBe(true);
  });

  it("gives km driven empty and revenue per km by route over the closed trips", async () => {
    const body = await usage(actors.DIRECTOR);
    expect(body.trips?.period).toEqual({ emptyKm: 300, loadedKm: 300, unknownLoadKm: 200 });
    expect(body.trips?.routes).toEqual([
      { key: "douala|yaoundé", from: "Douala", to: "Yaoundé", trips: 1, tripsWithKm: 1, km: 600, revenueMinor: 600_000, revenuePerKmMinor: 1000 },
      { key: "douala|edéa", from: "Douala", to: "Edéa", trips: 1, tripsWithKm: 1, km: 200, revenueMinor: 0, revenuePerKmMinor: null },
    ]);
    expect(body.trips?.tripsWithoutRoute).toBe(2);
  });

  it("gives km and status to every role that reads vehicles, and money only to those that read vehicle money", async () => {
    for (const role of ["ADMIN", "FINANCE"] as const) {
      expect((await usage(actors[role])).money).not.toBeNull();
    }
    for (const role of ["CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      const body = await usage(actors[role]);
      expect(body.money, role).toBeNull();
      expect(body.vehicles.every((row) => row.money === null), role).toBe(true);
      expect(body.trips?.routes.every((route) => route.revenueMinor === null && route.revenuePerKmMinor === null), role).toBe(true);
      // The vehicle's km whoever drove it: a driver never reads another truck's km as 0.
      expect(vehicle(body, "VH001").period?.km, role).toBe(600);
      expect(vehicle(body, "VH002").days.at(-1), role).toBe("ON_TRIP");
    }
    // A driver's route figures are their own trips only.
    expect((await usage(actors.DRIVER)).trips?.routes).toEqual([]);
  });

  it("stops at the caller's branches, and narrows by a branch inside them", async () => {
    const admin = await usage(actors.ADMIN);
    expect(admin.vehicles.map((row) => row.assetCode)).not.toContain("VH005");
    const yaounde = await usage(actors.DIRECTOR, `?branchId=${yaoundeId}`);
    expect(yaounde.vehicles.map((row) => row.assetCode)).toEqual(["VH005"]);
    const outside = await usage(actors.ADMIN, `?branchId=${yaoundeId}`);
    expect(outside.vehicles).toEqual([]);
    expect((await api.get(actors.DIRECTOR.token, "/v1/assets/usage?branchId=DLA")).status).toBe(400);
  });

  it("compares whole months on a longer range", async () => {
    const body = await usage(actors.DIRECTOR, "?range=THREE_MONTHS");
    expect(body.period.to < `${today.slice(0, 7)}-01`).toBe(true);
    expect(body.km?.period.knownKm).toBe(0);
    expect(body.money?.period.costPerKmMinor).toBeNull();
    // The board is always the last 30 days.
    expect(body.boardDays.at(-1)).toBe(today);
  });

  it("puts the fuel outlier in To do for the roles that read vehicle money only", async () => {
    const fuelRows = async (actor: Actor) => {
      const reply = await api.get(actor.token, "/v1/todo");
      expect(reply.status).toBe(200);
      return todoResponse.parse(reply.body).rows.filter((row) => row.code === "FUEL_PER_KM_HIGH");
    };
    const rows = await fuelRows(actors.DIRECTOR);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asset: { id: asset.VH003, assetCode: "VH003" },
      link: { kind: "asset", id: asset.VH003, number: "VH003" },
      params: { amountMinor: 300, medianMinor: 150, percentAbove: 100, currency: "XAF" },
    });
    expect(await fuelRows(actors.ADMIN)).toHaveLength(1);
    expect(await fuelRows(actors.TECHNICIAN)).toEqual([]);
    expect(await fuelRows(actors.CASHIER)).toEqual([]);
  });

  describe("with modules off", () => {
    let offWorkspace: { trips: string; maintenance: string; assets: string };
    let directors: Record<string, Actor>;

    beforeAll(async () => {
      directors = {};
      const ids: string[] = [];
      for (const key of ["trips", "maintenance", "assets"]) {
        const seeded = await seedWorkspace(ctx.db);
        ids.push(seeded.workspace.id);
        directors[key] = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "DIRECTOR" });
      }
      offWorkspace = { trips: ids[0]!, maintenance: ids[1]!, assets: ids[2]! };
      for (const key of ["trips", "maintenance"]) {
        const assetId = randomUUID();
        await api.ok(directors[key]!.token, "register-asset", {
          assetId,
          assetCode: "VH100",
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        });
        await api.ok(directors[key]!.token, "commission-asset", { assetId }, { expectedVersion: 1 });
        await api.ok(directors[key]!.token, "report-issue", { issueId: randomUUID(), assetId, description: "Freins", safetyCritical: true });
      }
      // Off once the facts are recorded: a module that is off keeps its records.
      await setModule(ctx.db, offWorkspace.trips, "ACTIVITIES", false);
      await setModule(ctx.db, offWorkspace.maintenance, "MAINTENANCE", false);
      await setModule(ctx.db, offWorkspace.assets, "ASSETS", false);
    });

    it("without Trips, knows no km, no money per km, and calls no day available", async () => {
      const body = await usage(directors.trips!);
      expect(body.km).toBeNull();
      expect(body.trips).toBeNull();
      expect(body.money).toBeNull();
      expect(vehicle(body, "VH100").period).toBeNull();
      expect(vehicle(body, "VH100").days.at(-1)).toBe("GROUNDED");
      expect(vehicle(body, "VH100").days.slice(0, -1).every((day) => day === "NOT_RECORDED")).toBe(true);
    });

    it("without Maintenance, counts no day off the road", async () => {
      const body = await usage(directors.maintenance!);
      expect(body.offRoadByMonth).toBeNull();
      expect(vehicle(body, "VH100").days.at(-1)).toBe("AVAILABLE");
    });

    it("without Vehicles, refuses", async () => {
      const reply = await api.get(directors.assets!.token, "/v1/assets/usage");
      expect(reply.status).toBe(403);
    });
  });
});

describe("fleet usage arithmetic", () => {
  const km = (value: number, known = true) => ({ km: value, known, tripsClosed: 1, tripsFromOdometer: 0, tripsWithoutKm: known ? 0 : 1 });

  it("rounds per km to the nearest unit and gives none without known km or money", () => {
    expect(perKm(210_000n, km(1300))).toBe(162n);
    expect(perKm(1_000n, km(3))).toBe(333n);
    expect(perKm(1_000n, km(0))).toBeNull();
    expect(perKm(1_000n, km(100, false))).toBeNull();
    expect(perKm(0n, km(100))).toBeNull();
    expect(perKm(-5n, km(100))).toBeNull();
  });

  it("takes the middle value, or the rounded mean of the two middle ones", () => {
    expect(median([])).toBeNull();
    expect(median([300n, 120n, 150n])).toBe(150n);
    expect(median([100n, 151n])).toBe(126n);
  });

  it("flags only more than 20% above the median", () => {
    expect(percentAbove(120n, 100n)).toBeNull();
    expect(percentAbove(121n, 100n)).toBe(21);
    expect(percentAbove(null, 100n)).toBeNull();
    expect(percentAbove(500n, null)).toBeNull();
  });

  it("judges the most serious fact first and leaves days before commissioning not recorded", () => {
    const days = judgeDays(
      [{ id: "a", knownFrom: "2026-10-03" }],
      {
        trips: [{ assetId: "a", from: "2026-10-01", to: "2026-10-05" }],
        workshop: [{ assetId: "a", from: "2026-10-04", to: null }],
        grounded: [{ assetId: "a", from: "2026-10-05", to: "2026-10-05" }],
      },
      "2026-09-30",
      "2026-10-07",
      true,
    ).get("a");
    expect([...days!.values()]).toEqual([
      "NOT_RECORDED", // Sep 30: before commissioning, no fact
      "ON_TRIP", // Oct 1: a trip is a fact even before commissioning
      "ON_TRIP",
      "ON_TRIP",
      "WORKSHOP", // the work order outranks the trip
      "GROUNDED", // grounding outranks both
      "WORKSHOP", // still open
      "WORKSHOP",
    ]);
  });
});
