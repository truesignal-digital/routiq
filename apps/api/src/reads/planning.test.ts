import { randomUUID } from "node:crypto";
import { planningResponse, type PlanningResponse } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";

/**
 * #336, ADR-0012 §7: the planning board's read. Transports Ngwa books
 * November runs out of Douala; the workspace keeps Douala time (UTC+1), so
 * days, weeks and months are cut at Douala midnights.
 */
describe("GET /v1/planning (#336)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let director: Actor;
  let admin: Actor;
  let yaoundeAdmin: Actor;
  let finance: Actor;
  let technician: Actor;
  let cashier: Actor;
  let driver: Actor;
  let yaoundeBranchId: string;
  let truckA: string;
  let truckB: string;
  let groundedTruck: string;
  let yaoundeTruck: string;
  let foreignAssetId: string;
  let moussa: string;
  let paul: string;

  const trips: Record<string, string> = {};

  async function person(displayName: string, branchCode = "DLA"): Promise<string> {
    const personId = randomUUID();
    await api.ok(admin.token, "register-person", { personId, displayName, branchCode, defaultRole: "DRIVER" });
    return personId;
  }

  async function plan(key: string, extra: Record<string, unknown>): Promise<string> {
    const activityId = randomUUID();
    await api.ok(admin.token, "plan-trip", {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      ...extra,
    });
    trips[key] = activityId;
    return activityId;
  }

  async function planning(actor: Actor, query: string): Promise<PlanningResponse> {
    const response = await api.get(actor.token, `/v1/planning?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return planningResponse.parse(response.body);
  }

  const ids = (body: PlanningResponse) => body.trips.map((trip) => trip.id);
  const trip = (body: PlanningResponse, key: string) => {
    const found = body.trips.find((row) => row.id === trips[key]);
    if (!found) throw new Error(`trip ${key} not in the response`);
    return found;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");
    yaoundeBranchId = yaounde.id;

    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    yaoundeAdmin = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [yaounde.id] });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    technician = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER", branchIds: [seeded.branch.id] });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    await setModule(ctx.db, workspaceId, "SCHEDULING", true);

    truckA = await seedAsset(ctx.app, admin.token, { assetCode: "PLN-A" });
    truckB = await seedAsset(ctx.app, admin.token, { assetCode: "PLN-B" });
    groundedTruck = await seedAsset(ctx.app, admin.token, { assetCode: "PLN-GROUNDED" });
    yaoundeTruck = await seedAsset(ctx.app, admin.token, { assetCode: "PLN-YDE", branchCode: "YDE" });
    moussa = await person("Moussa Bello");
    paul = await person("Paul Etoundi");

    const foreign = await seedWorkspace(ctx.db);
    const foreignAdmin = await seedActor(ctx.db, { workspaceId: foreign.workspace.id, role: "ADMIN" });
    foreignAssetId = await seedAsset(ctx.app, foreignAdmin.token);

    // Late on Saturday 31 October, Douala time: 22:30 UTC. No planned end, so
    // it holds its truck until Douala midnight, still 31 October.
    await plan("lateOctober", {
      plannedStartAt: "2026-10-31T23:30:00+01:00",
      plannedAssetId: truckB,
      plannedDriverPersonId: paul,
      customerName: "Brasseries du Cameroun",
      agreedPriceMinor: 450_000,
    });
    // Monday 2 November: two bookings on truck A that overlap, one fully
    // assigned and priced, one without a driver.
    await plan("cement", {
      plannedStartAt: "2026-11-02T07:00:00+01:00",
      plannedEndAt: "2026-11-02T18:00:00+01:00",
      plannedAssetId: truckA,
      plannedDriverPersonId: moussa,
      customerName: "Cimencam",
      description: "30 t de ciment",
      origin: { kind: "text", text: "Douala" },
      destination: { kind: "text", text: "Yaoundé" },
      agreedPriceMinor: 900_000,
      amountToCollectMinor: 300_000,
    });
    await plan("overlap", {
      plannedStartAt: "2026-11-02T14:00:00+01:00",
      plannedEndAt: "2026-11-02T20:00:00+01:00",
      plannedAssetId: truckA,
      customerName: "Sodecoton",
      agreedPriceMinor: 200_000,
    });
    // Three days, Sunday 8 to Tuesday 10 November, across the ISO week edge.
    await plan("acrossWeek", {
      plannedStartAt: "2026-11-08T06:00:00+01:00",
      plannedEndAt: "2026-11-10T12:00:00+01:00",
      plannedDriverPersonId: paul,
    });
    // Monday 30 November into Tuesday 1 December: the month edge.
    await plan("acrossMonth", {
      plannedStartAt: "2026-11-30T20:00:00+01:00",
      plannedEndAt: "2026-12-01T08:00:00+01:00",
      plannedAssetId: truckB,
    });
    // Booked on a truck that is grounded now.
    await plan("onGrounded", { plannedStartAt: "2026-11-04T08:00:00+01:00", plannedAssetId: groundedTruck });
    await api.ok(admin.token, "report-issue", {
      issueId: randomUUID(),
      assetId: groundedTruck,
      description: "Freins qui lâchent",
      safetyCritical: true,
    });
    // Called off.
    await plan("cancelled", { plannedStartAt: "2026-11-03T08:00:00+01:00", customerName: "Annulé SA" });
    await api.ok(
      admin.token,
      "cancel-planned-trip",
      { activityId: trips.cancelled, reason: "CUSTOMER_CANCELLED" },
      { expectedVersion: 1 },
    );
    // Yaoundé's own booking, out of a Douala-only reader's branches and back.
    await api.ok(admin.token, "plan-trip", {
      activityId: (trips.yaounde = randomUUID()),
      branchCode: "YDE",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      plannedStartAt: "2026-11-02T09:00:00+01:00",
      plannedAssetId: yaoundeTruck,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("cuts days at Douala midnight: a 23:30 booking belongs to its own day", async () => {
    const october = await planning(admin, "from=2026-10-31&to=2026-10-31");
    expect(ids(october)).toContain(trips.lateOctober);
    const lateOctober = trip(october, "lateOctober");
    // The window closes at the end of that Douala day, not 24 hours later.
    expect(lateOctober.window).toEqual({
      start: "2026-10-31T22:30:00.000Z",
      end: "2026-10-31T23:00:00.000Z",
    });
    expect(october.days).toEqual([{ date: "2026-10-31", planned: 1, toAssign: 0, conflicts: 0 }]);

    const november = await planning(admin, "from=2026-11-01&to=2026-11-01");
    expect(ids(november)).not.toContain(trips.lateOctober);
    expect(november.range).toEqual({ from: "2026-11-01", to: "2026-11-01", timezone: "Africa/Douala" });
  });

  it("lays a trip on every day, week and month it spans", async () => {
    const weekBefore = await planning(admin, "from=2026-11-02&to=2026-11-08");
    const weekAfter = await planning(admin, "from=2026-11-09&to=2026-11-15");
    expect(ids(weekBefore)).toContain(trips.acrossWeek);
    expect(ids(weekAfter)).toContain(trips.acrossWeek);
    expect(weekAfter.days.slice(0, 3).map((day) => day.planned)).toEqual([1, 1, 0]);

    const november = await planning(admin, "from=2026-11-01&to=2026-11-30");
    const december = await planning(admin, "from=2026-12-01&to=2026-12-31");
    expect(ids(november)).toContain(trips.acrossMonth);
    expect(ids(december)).toContain(trips.acrossMonth);
    expect(november.days).toHaveLength(30);
  });

  it("orders trips by window start, then trip number", async () => {
    const body = await planning(admin, "from=2026-10-31&to=2026-11-30");
    const starts = body.trips.map((row) => row.window.start);
    expect(starts).toEqual([...starts].sort());
    expect(ids(body).slice(0, 3)).toEqual([trips.lateOctober, trips.cement, trips.yaounde]);
  });

  it("returns an empty range as empty, with every day counted", async () => {
    const body = await planning(admin, "from=2027-03-01&to=2027-03-07");
    expect(body.trips).toEqual([]);
    expect(body.days).toHaveLength(7);
    expect(body.days.every((day) => day.planned === 0 && day.toAssign === 0 && day.conflicts === 0)).toBe(true);
    expect(body.summary).toMatchObject({ planned: 0, toAssign: 0, conflicts: 0, vehiclesBooked: 0 });
  });

  it("caps the range at 42 days and refuses a backwards one", async () => {
    expect((await api.get(admin.token, "/v1/planning?from=2026-11-01&to=2026-12-12")).status).toBe(200);
    for (const query of [
      "from=2026-11-01&to=2026-12-13",
      "from=2026-11-10&to=2026-11-09",
      "from=2026-11-01",
      "from=2026-11-01T00:00:00Z&to=2026-11-02",
    ]) {
      const response = await api.get(admin.token, `/v1/planning?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
    }
  });

  it("recomputes double bookings on every read, until someone resolves them", async () => {
    let body = await planning(admin, "from=2026-11-02&to=2026-11-02");
    expect(trip(body, "cement").conflicts).toEqual(["VEHICLE_DOUBLE_BOOKED"]);
    expect(trip(body, "overlap").conflicts).toEqual(["VEHICLE_DOUBLE_BOOKED"]);
    expect(body.days).toEqual([{ date: "2026-11-02", planned: 3, toAssign: 2, conflicts: 2 }]);

    await api.ok(
      admin.token,
      "assign-trip",
      { activityId: trips.overlap, plannedAssetId: truckB, plannedDriverPersonId: null },
      { expectedVersion: 1 },
    );
    body = await planning(admin, "from=2026-11-02&to=2026-11-02");
    expect(trip(body, "cement").conflicts).toEqual([]);
    expect(trip(body, "overlap").conflicts).toEqual([]);
    expect(trip(body, "overlap").lastChange).toMatchObject({ kind: "ASSIGNED", displayName: admin.displayName });
    expect(trip(body, "cement").lastChange).toBeNull();
    expect(trip(body, "cement").plannedBy).toMatchObject({ displayName: admin.displayName });
  });

  it("names what a planned trip needs: vehicle, driver, route and cargo", async () => {
    const cement = trip(await planning(admin, "from=2026-11-02&to=2026-11-02"), "cement");
    expect(cement).toMatchObject({
      status: "PLANNED",
      customerName: "Cimencam",
      description: "30 t de ciment",
      originName: "Douala",
      destinationName: "Yaoundé",
      vehicle: { id: truckA, assetCode: "PLN-A", planned: true },
      driver: { personId: moussa, displayName: "Moussa Bello", planned: true },
      startedAt: null,
      priceCurrency: "XAF",
    });
  });

  it("leaves cancelled bookings out unless asked, and keeps their reason", async () => {
    const without = await planning(admin, "from=2026-11-03&to=2026-11-03");
    expect(ids(without)).not.toContain(trips.cancelled);
    const withCancelled = await planning(admin, "from=2026-11-03&to=2026-11-03&includeCancelled=true");
    expect(trip(withCancelled, "cancelled")).toMatchObject({
      status: "CANCELLED",
      cancellation: { reason: "CUSTOMER_CANCELLED", note: null },
    });
    expect(withCancelled.days[0]?.planned).toBe(0);
  });

  it("shows grounded blocks and the grounding warning only while Maintenance is on", async () => {
    const body = await planning(admin, "from=2026-11-04&to=2026-11-04");
    expect(trip(body, "onGrounded").conflicts).toEqual(["VEHICLE_GROUNDED"]);
    const grounded = body.vehicles.find((vehicle) => vehicle.id === groundedTruck);
    expect(grounded?.blocks).toEqual([
      expect.objectContaining({ to: null, workOrderId: null, issueId: expect.any(String) }),
    ]);
    expect(body.vehicles.find((vehicle) => vehicle.id === truckA)?.blocks).toEqual([]);
  });

  it("narrows by vehicle, driver and customer inside the caller's branches", async () => {
    const range = "from=2026-10-31&to=2026-11-30";
    const byTruck = await planning(admin, `${range}&assetId=${truckB}`);
    expect(ids(byTruck).sort()).toEqual([trips.lateOctober, trips.overlap, trips.acrossMonth].sort());
    expect(byTruck.vehicles.map((vehicle) => vehicle.id)).toEqual([truckB]);

    const byDriver = await planning(admin, `${range}&personId=${paul}`);
    expect(ids(byDriver).sort()).toEqual([trips.lateOctober, trips.acrossWeek].sort());
    expect(byDriver.drivers.map((row) => row.personId)).toEqual([paul]);

    const byCustomer = await planning(admin, `${range}&customer=cimen`);
    expect(ids(byCustomer)).toEqual([trips.cement]);
  });

  it("keeps a branch-scoped reader in their branches and answers other ids as not found", async () => {
    const range = "from=2026-11-01&to=2026-11-30";
    const body = await planning(yaoundeAdmin, range);
    expect(ids(body)).toEqual([trips.yaounde]);
    expect(body.vehicles.map((vehicle) => vehicle.id)).toEqual([yaoundeTruck]);
    expect(body.drivers).toEqual([]);

    for (const query of [`assetId=${truckA}`, `personId=${moussa}`]) {
      const response = await api.get(yaoundeAdmin.token, `/v1/planning?${range}&${query}`);
      expect(response.status, query).toBe(404);
      expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    }
    const foreign = await api.get(admin.token, `/v1/planning?${range}&assetId=${foreignAssetId}`);
    expect(foreign.status).toBe(404);
    const unknownBranch = await api.get(admin.token, `/v1/planning?${range}&branchId=${randomUUID()}`);
    expect(unknownBranch.status).toBe(404);
    expect((await planning(admin, `${range}&branchId=${yaoundeBranchId}`)).trips.map((row) => row.id)).toEqual([
      trips.yaounde,
    ]);
  });

  it("serves the price only to the roles that read the ledger, as an omitted key for the rest", async () => {
    const range = "from=2026-10-31&to=2026-11-30";
    for (const actor of [director, admin, finance]) {
      const body = await planning(actor, range);
      expect(trip(body, "cement")).toMatchObject({ agreedPriceMinor: 900_000, amountToCollectMinor: 300_000 });
      expect(trip(body, "acrossWeek")).toMatchObject({ agreedPriceMinor: null, amountToCollectMinor: null });
      // PLANNED only: 450 000 + 900 000 + 200 000.
      expect(body.summary.plannedRevenueMinor).toBe(1_550_000);
      expect(body.summary.currency).toBe("XAF");
    }
    const workshop = await planning(technician, range);
    for (const row of workshop.trips) {
      expect(Object.keys(row)).not.toContain("agreedPriceMinor");
      expect(Object.keys(row)).not.toContain("amountToCollectMinor");
    }
    expect(Object.keys(workshop.summary)).not.toContain("plannedRevenueMinor");
  });

  it("refuses the roles that do not plan", async () => {
    for (const actor of [cashier, driver]) {
      const response = await api.get(actor.token, "/v1/planning?from=2026-11-01&to=2026-11-07");
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    }
  });

  it("counts the range in the summary: bookings, gaps, conflicts and trucks", async () => {
    const body = await planning(admin, "from=2026-10-31&to=2026-11-30");
    expect(body.summary).toMatchObject({
      // lateOctober, cement, overlap, acrossWeek, acrossMonth, onGrounded, yaounde.
      planned: 7,
      toAssign: 5,
      conflicts: 1,
      vehiclesBooked: 4,
      vehiclesTotal: 4,
    });
  });
});

describe("GET /v1/planning with modules off (#336)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let director: Actor;
  let admin: Actor;
  let truck: string;
  let workspaceId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    director = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "DIRECTOR" });
    admin = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN" });
    truck = await seedAsset(ctx.app, admin.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("is MODULE_DISABLED while Scheduling is off, as it is by default", async () => {
    const response = await api.get(admin.token, "/v1/planning?from=2026-11-01&to=2026-11-07");
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: "MODULE_DISABLED", metadata: { module: "SCHEDULING" } } });
  });

  it("reports availability as unknown, not as none, with Maintenance off", async () => {
    await setModule(ctx.db, workspaceId, "SCHEDULING", true);
    await api.ok(admin.token, "report-issue", {
      issueId: randomUUID(),
      assetId: truck,
      description: "Pneu crevé",
      safetyCritical: true,
    });
    await api.ok(admin.token, "plan-trip", {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      plannedStartAt: "2026-11-02T08:00:00+01:00",
      plannedAssetId: truck,
    });
    await setModule(ctx.db, workspaceId, "MAINTENANCE", false);
    const response = await api.get(admin.token, "/v1/planning?from=2026-11-02&to=2026-11-02");
    expect(response.status).toBe(200);
    const body = planningResponse.parse(response.body);
    expect(body.vehicles.map((vehicle) => vehicle.blocks)).toEqual([null]);
    expect(body.trips.map((row) => row.conflicts)).toEqual([[]]);

    await setModule(ctx.db, workspaceId, "FINANCE", false);
    const noFinance = planningResponse.parse(
      (await api.get(director.token, "/v1/planning?from=2026-11-02&to=2026-11-02")).body,
    );
    expect(Object.keys(noFinance.summary)).not.toContain("plannedRevenueMinor");
    expect(Object.keys(noFinance.trips[0] ?? {})).not.toContain("agreedPriceMinor");
  });
});
