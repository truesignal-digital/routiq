import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  assets,
  auditEvents,
  branches,
  financialPostings,
  meterReadings,
  persons,
} from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * ADR-0012 for #334: a booking is the trip record itself, PLANNED, and
 * start-planned-trip turns that row OPEN. Cimencam's cement run from Douala to
 * Yaoundé is booked on Monday for Thursday, assigned, moved, and started.
 */
describe("planned trips (ADR-0012)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let director: Actor;
  let admin: Actor;
  let yaoundeAdmin: Actor;
  let finance: Actor;
  let driver: Actor;
  let otherDriver: Actor;
  let driverPersonId: string;
  let otherDriverPersonId: string;
  let mechanicPersonId: string;
  let retiredDriverPersonId: string;
  let yaoundeTruckId: string;
  let foreignAssetId: string;

  async function registerPerson(defaultRole: string, membershipId?: string): Promise<string> {
    const personId = randomUUID();
    await api.ok(admin.token, "register-person", {
      personId,
      displayName: `person-${personId.slice(0, 6)}`,
      branchCode: "DLA",
      defaultRole,
    });
    if (membershipId !== undefined) {
      await ctx.db.update(persons).set({ membershipId }).where(eq(persons.id, personId));
    }
    return personId;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");

    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    yaoundeAdmin = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [yaounde.id] });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    otherDriver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });

    await api.ok(director.token, "enable-module", { moduleCode: "SCHEDULING" });

    driverPersonId = await registerPerson("DRIVER", driver.membershipId);
    otherDriverPersonId = await registerPerson("DRIVER", otherDriver.membershipId);
    mechanicPersonId = await registerPerson("MECHANIC");
    retiredDriverPersonId = await registerPerson("DRIVER");
    await ctx.db.update(persons).set({ active: false }).where(eq(persons.id, retiredDriverPersonId));

    yaoundeTruckId = await seedAsset(ctx.app, admin.token, { branchCode: "YDE" });

    const foreign = await seedWorkspace(ctx.db);
    const foreignAdmin = await seedActor(ctx.db, { workspaceId: foreign.workspace.id, role: "ADMIN" });
    foreignAssetId = await seedAsset(ctx.app, foreignAdmin.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const truck = () => seedAsset(ctx.app, admin.token);

  function plan(extra: Record<string, unknown> = {}, opts: { token?: string; envelope?: Record<string, unknown> } = {}) {
    return api.send(
      opts.token ?? admin.token,
      "plan-trip",
      {
        activityId: randomUUID(),
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        plannedStartAt: "2026-11-05T07:00:00+01:00",
        ...extra,
      },
      opts.envelope ?? {},
    );
  }

  async function planned(extra: Record<string, unknown> = {}): Promise<string> {
    const reply = await plan(extra);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    return reply.body.recordId!;
  }

  async function trip(id: string) {
    const [row] = await ctx.db.select().from(activities).where(eq(activities.id, id));
    if (!row) throw new Error(`no trip ${id}`);
    return row;
  }

  function startPayload(activityId: string, assetId: string, extra: Record<string, unknown> = {}) {
    return {
      activityId,
      primarySegmentId: randomUUID(),
      primaryAssetId: assetId,
      startedAt: "2026-11-05T07:20:00+01:00",
      ...extra,
    };
  }

  async function started(assetId?: string, startedAt?: string): Promise<string> {
    const vehicle = assetId ?? (await truck());
    const id = await planned({ plannedAssetId: vehicle });
    await api.ok(
      admin.token,
      "start-planned-trip",
      startPayload(id, vehicle, startedAt === undefined ? {} : { startedAt }),
    );
    return id;
  }

  const ended = { endedAt: "2026-11-05T19:00:00+01:00" };

  async function cancelled(): Promise<string> {
    const id = await planned();
    await api.ok(
      admin.token,
      "cancel-planned-trip",
      { activityId: id, reason: "CUSTOMER_CANCELLED" },
      { expectedVersion: 1 },
    );
    return id;
  }

  async function closed(): Promise<string> {
    const id = await started();
    await api.ok(
      admin.token,
      "close-activity",
      { activityId: id, ...ended },
      { expectedVersion: (await trip(id)).rowVersion },
    );
    return id;
  }

  /** Each office edit of a trip, as a valid request against its current version. */
  async function edits(id: string): Promise<Array<[string, Record<string, unknown>]>> {
    return [
      ["assign-trip", { activityId: id, plannedAssetId: null, plannedDriverPersonId: null }],
      ["reschedule-trip", { activityId: id, plannedStartAt: "2026-11-06T07:00:00+01:00" }],
      ["update-planned-trip", { activityId: id, customerName: "Cimencam" }],
      ["cancel-planned-trip", { activityId: id, reason: "BOOKED_TWICE" }],
    ];
  }

  describe("plan-trip", () => {
    it("books a trip with no vehicle, driver or actual start, and posts nothing", async () => {
      const reply = await plan({
        customerName: "Cimencam",
        clientReference: "BL-2291",
        description: "30 t de ciment",
        plannedEndAt: "2026-11-05T19:00:00+01:00",
        origin: { kind: "place", placeId: randomUUID(), name: "Douala" },
        destination: { kind: "text", text: "Yaoundé, dépôt Mvan" },
        agreedPriceMinor: 450_000,
        amountToCollectMinor: 150_000,
      });
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ rowVersion: 1, recordStatus: "PLANNED", warnings: [] });

      const row = await trip(reply.body.recordId!);
      expect(row).toMatchObject({
        status: "PLANNED",
        startedAt: null,
        plannedStartAt: new Date("2026-11-05T06:00:00Z"),
        plannedEndAt: new Date("2026-11-05T18:00:00Z"),
        plannedAssetId: null,
        plannedDriverPersonId: null,
        plannedOriginText: null,
        plannedDestinationText: "Yaoundé, dépôt Mvan",
        agreedPriceMinor: 450_000n,
        amountToCollectMinor: 150_000n,
        priceCurrency: "XAF",
        discrepancyCodes: [],
      });
      expect(row.plannedOriginPlaceId).not.toBeNull();
      expect(row.activityNumber).toMatch(/^DLA-2026-\d{5}$/);

      const segments = await ctx.db
        .select()
        .from(activityAssetSegments)
        .where(eq(activityAssetSegments.activityId, row.id));
      const crew = await ctx.db.select().from(activityPeople).where(eq(activityPeople.activityId, row.id));
      const postings = await ctx.db
        .select()
        .from(financialPostings)
        .where(eq(financialPostings.activityId, row.id));
      expect([segments, crew, postings]).toEqual([[], [], []]);

      const [event] = await ctx.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, row.id), eq(auditEvents.eventType, "activity.planned")));
      expect(event?.afterState).toMatchObject({ status: "PLANNED", agreedPriceMinor: 450_000 });
    });

    it("numbers the trip from the planned start's business date in the workspace time zone", async () => {
      // 23:30 UTC on 31 December is already 1 January in Douala.
      const id = await planned({ plannedStartAt: "2026-12-31T23:30:00Z" });
      expect((await trip(id)).activityNumber).toMatch(/^DLA-2027-/);
    });

    it("refuses an ineligible driver: inactive, or not a Chauffeur", async () => {
      const inactive = await plan({ plannedDriverPersonId: retiredDriverPersonId });
      expect(inactive.status).toBe(422);
      expect(inactive.body.error).toEqual({
        code: "DRIVER_INELIGIBLE",
        metadata: { personId: retiredDriverPersonId, reason: "INACTIVE" },
      });
      const mechanic = await plan({ plannedDriverPersonId: mechanicPersonId });
      expect(mechanic.body.error).toMatchObject({
        code: "DRIVER_INELIGIBLE",
        metadata: { reason: "NOT_A_DRIVER" },
      });
    });

    it("refuses a sold vehicle (ASSET_NOT_OPERATIONAL)", async () => {
      const sold = await truck();
      await ctx.db.update(assets).set({ lifecycleStatus: "SOLD" }).where(eq(assets.id, sold));
      const reply = await plan({ plannedAssetId: sold });
      expect(reply.status).toBe(409);
      expect(reply.body.error?.code).toBe("ASSET_NOT_OPERATIONAL");
    });

    it("cannot name another workspace's vehicle", async () => {
      const reply = await plan({ plannedAssetId: foreignAssetId });
      expect(reply.status).toBe(422);
      expect(reply.body.error).toMatchObject({
        code: "REFERENCE_NOT_FOUND",
        metadata: { referenceType: "asset" },
      });
    });

    it("lets an exact retry return the original result and nothing more", async () => {
      const activityId = randomUUID();
      const envelope = { commandId: randomUUID(), idempotencyKey: `plan-${activityId}` };
      const first = await plan({ activityId }, { envelope });
      const retry = await plan({ activityId }, { envelope });
      expect(retry.body).toEqual({ ...first.body, idempotentReplay: true });
      const rows = await ctx.db.select().from(activities).where(eq(activities.id, activityId));
      expect(rows).toHaveLength(1);
    });
  });

  describe("what the database refuses", () => {
    it("a planned trip with an actual start", async () => {
      const id = await planned();
      await expect(
        ctx.db.update(activities).set({ startedAt: new Date() }).where(eq(activities.id, id)),
      ).rejects.toMatchObject({ cause: { constraint: "activities_started_at_ck" } });
    });

    it("a started trip without one, a planned trip without a planned start, a cancellation without a reason", async () => {
      const open = await started();
      await expect(
        ctx.db.update(activities).set({ startedAt: null }).where(eq(activities.id, open)),
      ).rejects.toMatchObject({ cause: { constraint: "activities_started_at_ck" } });
      const id = await planned();
      await expect(
        ctx.db.update(activities).set({ plannedStartAt: null }).where(eq(activities.id, id)),
      ).rejects.toMatchObject({ cause: { constraint: "activities_planned_start_ck" } });
      await expect(
        ctx.db
          .update(activities)
          .set({ status: "CANCELLED", cancelledAt: new Date() })
          .where(eq(activities.id, id)),
      ).rejects.toMatchObject({ cause: { constraint: "activities_cancellation_ck" } });
      await expect(
        ctx.db.update(activities).set({ agreedPriceMinor: -1n }).where(eq(activities.id, id)),
      ).rejects.toMatchObject({ cause: { constraint: "activities_price_ck" } });
    });
  });

  describe("allowed and refused transitions", () => {
    it("edits a PLANNED trip and moves it, keeping its number", async () => {
      const id = await planned();
      const number = (await trip(id)).activityNumber;
      const vehicle = await truck();

      const assigned = await api.send(
        admin.token,
        "assign-trip",
        { activityId: id, plannedAssetId: vehicle, plannedDriverPersonId: driverPersonId },
        { expectedVersion: 1 },
      );
      expect(assigned.body).toMatchObject({ rowVersion: 2, recordStatus: "PLANNED" });

      const moved = await api.send(
        admin.token,
        "reschedule-trip",
        { activityId: id, plannedStartAt: "2027-01-04T07:00:00+01:00" },
        { expectedVersion: 2 },
      );
      expect(moved.body).toMatchObject({ rowVersion: 3 });

      const updated = await api.send(
        admin.token,
        "update-planned-trip",
        { activityId: id, agreedPriceMinor: 500_000, description: null },
        { expectedVersion: 3 },
      );
      expect(updated.body).toMatchObject({ rowVersion: 4 });

      expect(await trip(id)).toMatchObject({
        status: "PLANNED",
        activityNumber: number,
        plannedAssetId: vehicle,
        plannedDriverPersonId: driverPersonId,
        plannedStartAt: new Date("2027-01-04T06:00:00Z"),
        agreedPriceMinor: 500_000n,
        rowVersion: 4,
      });

      const [assignEvent] = await ctx.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, id), eq(auditEvents.eventType, "activity.assigned")));
      expect(assignEvent).toMatchObject({
        beforeState: { plannedAssetId: null, plannedDriverPersonId: null, rowVersion: 1 },
        afterState: { plannedAssetId: vehicle, plannedDriverPersonId: driverPersonId, rowVersion: 2 },
      });
      const postings = await ctx.db
        .select()
        .from(financialPostings)
        .where(eq(financialPostings.activityId, id));
      expect(postings).toEqual([]);
    });

    it("cancels a PLANNED trip and keeps it, with its reason", async () => {
      const id = await planned();
      const reply = await api.send(
        admin.token,
        "cancel-planned-trip",
        { activityId: id, reason: "OTHER", note: "Route coupée à Edéa" },
        { expectedVersion: 1 },
      );
      expect(reply.body).toMatchObject({ recordStatus: "CANCELLED", rowVersion: 2 });
      expect(await trip(id)).toMatchObject({
        status: "CANCELLED",
        startedAt: null,
        cancellationReason: "OTHER",
        cancellationNote: "Route coupée à Edéa",
        cancelledByCommandId: reply.body.commandId,
      });
    });

    for (const [label, make] of [
      ["OPEN", () => started()],
      ["CLOSED", () => closed()],
      ["CANCELLED", () => cancelled()],
    ] as const) {
      it(`refuses every office edit on a ${label} trip`, async () => {
        const id = await make();
        const { rowVersion } = await trip(id);
        for (const [name, payload] of await edits(id)) {
          const reply = await api.send(admin.token, name, payload, { expectedVersion: rowVersion });
          expect(reply.status, name).toBe(409);
          expect(reply.body.error, name).toMatchObject({
            code: "INVALID_STATE_TRANSITION",
            metadata: { from: label },
          });
        }
      });
    }

    it("starts a PLANNED trip once: actual start, PRIMARY segment, reading and crew, no leg or posting", async () => {
      const vehicle = await truck();
      const id = await planned({ plannedAssetId: vehicle, plannedDriverPersonId: driverPersonId });
      const readingId = randomUUID();
      const payload = startPayload(id, vehicle, {
        startReading: {
          readingId,
          readingType: "ODOMETER",
          value: 412_300,
          observedAt: "2026-11-05T07:15:00+01:00",
        },
        crew: [{ activityPersonId: randomUUID(), personId: driverPersonId, role: "DRIVER" }],
      });
      const envelope = { commandId: randomUUID(), idempotencyKey: `start-${id}` };
      const first = await api.send(admin.token, "start-planned-trip", payload, envelope);
      expect(first.body).toMatchObject({ recordStatus: "OPEN", rowVersion: 2, warnings: [] });

      const retry = await api.send(admin.token, "start-planned-trip", payload, envelope);
      expect(retry.body).toEqual({ ...first.body, idempotentReplay: true });

      const again = await api.send(admin.token, "start-planned-trip", startPayload(id, vehicle));
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        metadata: { from: "OPEN", to: "OPEN" },
      });

      expect(await trip(id)).toMatchObject({
        status: "OPEN",
        startedAt: new Date("2026-11-05T06:20:00Z"),
        plannedAssetId: vehicle,
      });
      const segments = await ctx.db
        .select()
        .from(activityAssetSegments)
        .where(eq(activityAssetSegments.activityId, id));
      expect(segments).toEqual([
        expect.objectContaining({ assetId: vehicle, role: "PRIMARY", startReadingId: readingId }),
      ]);
      const crew = await ctx.db.select().from(activityPeople).where(eq(activityPeople.activityId, id));
      expect(crew).toHaveLength(1);
      const readings = await ctx.db.select().from(meterReadings).where(eq(meterReadings.activityId, id));
      expect(readings).toEqual([expect.objectContaining({ source: "ACTIVITY_START", value: 412_300n })]);
      const postings = await ctx.db
        .select()
        .from(financialPostings)
        .where(eq(financialPostings.activityId, id));
      expect(postings).toEqual([]);
    });

    it("refuses to start a CLOSED trip", async () => {
      const id = await closed();
      const reply = await api.send(admin.token, "start-planned-trip", startPayload(id, await truck()));
      expect(reply.body.error).toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        metadata: { from: "CLOSED" },
      });
    });
  });

  describe("stale and missing versions", () => {
    it("refuses assign, reschedule, update and cancel against another version, or none", async () => {
      const id = await planned();
      for (const [name, payload] of await edits(id)) {
        const stale = await api.send(admin.token, name, payload, { expectedVersion: 7 });
        expect(stale.status, name).toBe(409);
        expect(stale.body.error, name).toEqual({
          code: "VERSION_CONFLICT",
          metadata: { expectedVersion: 7, currentVersion: 1 },
        });
        const missing = await api.send(admin.token, name, payload);
        expect(missing.status, name).toBe(400);
        expect(missing.body.error?.code, name).toBe("EXPECTED_VERSION_REQUIRED");
      }
      expect((await trip(id)).rowVersion).toBe(1);
    });
  });

  describe("roles, branch scope and own trips", () => {
    it("lets only Direction and the Administrateur book and edit, and refuses Finance a start", async () => {
      const id = await planned();
      for (const actor of [finance, driver]) {
        expect((await plan({}, { token: actor.token })).body.error?.code).toBe("ROLE_FORBIDDEN");
        for (const [name, payload] of await edits(id)) {
          const reply = await api.send(actor.token, name, payload, { expectedVersion: 1 });
          expect(reply.body.error?.code, name).toBe("ROLE_FORBIDDEN");
        }
      }
      const start = await api.send(finance.token, "start-planned-trip", startPayload(id, await truck()));
      expect(start.body.error?.code).toBe("ROLE_FORBIDDEN");
      expect((await plan({}, { token: director.token })).status).toBe(200);
    });

    it("holds an Administrateur to their branches: the trip's and the vehicle's", async () => {
      expect((await plan({}, { token: yaoundeAdmin.token })).body.error?.code).toBe("ROLE_FORBIDDEN");
      const dlaTruck = await truck();
      expect(
        (await plan({ branchCode: "YDE", plannedAssetId: dlaTruck }, { token: yaoundeAdmin.token })).body
          .error?.code,
      ).toBe("ROLE_FORBIDDEN");
      expect(
        (await plan({ branchCode: "YDE", plannedAssetId: yaoundeTruckId }, { token: yaoundeAdmin.token }))
          .status,
      ).toBe(200);

      const id = await planned();
      const assign = await api.send(
        yaoundeAdmin.token,
        "assign-trip",
        { activityId: id, plannedAssetId: null, plannedDriverPersonId: null },
        { expectedVersion: 1 },
      );
      expect(assign.body.error?.code).toBe("ROLE_FORBIDDEN");
    });

    it("lets a driver start the trip they are planned to drive, and nobody else's", async () => {
      const vehicle = await truck();
      const id = await planned({ plannedAssetId: vehicle, plannedDriverPersonId: driverPersonId });
      const notMine = await api.send(otherDriver.token, "start-planned-trip", startPayload(id, vehicle));
      expect(notMine.status).toBe(403);
      expect(notMine.body.error?.code).toBe("OWN_RECORDS_ONLY");

      const mine = await api.send(
        driver.token,
        "start-planned-trip",
        startPayload(id, vehicle, {
          crew: [{ activityPersonId: randomUUID(), personId: driverPersonId, role: "DRIVER" }],
        }),
      );
      expect(mine.body).toMatchObject({ recordStatus: "OPEN" });

      // The office booked it, and the driver still closes it: they are its driver.
      const close = await api.send(
        driver.token,
        "close-activity",
        { activityId: id, ...ended },
        { expectedVersion: (await trip(id)).rowVersion },
      );
      expect(close.status, JSON.stringify(close.body)).toBe(200);
    });
  });

  describe("collisions warn, and say which trips", () => {
    it("warns VEHICLE_DOUBLE_BOOKED when the windows overlap, not on another day", async () => {
      const vehicle = await truck();
      const first = await planned({ plannedAssetId: vehicle, plannedStartAt: "2026-11-10T06:00:00+01:00" });
      // No planned end: the first booking holds the truck to the end of its business day.
      const second = await plan({ plannedAssetId: vehicle, plannedStartAt: "2026-11-10T22:00:00+01:00" });
      expect(second.body.warnings).toEqual(["VEHICLE_DOUBLE_BOOKED"]);
      expect(second.body).toMatchObject({ warningMetadata: { VEHICLE_DOUBLE_BOOKED: { tripIds: [first] } } });

      const nextDay = await plan({ plannedAssetId: vehicle, plannedStartAt: "2026-11-11T00:00:00+01:00" });
      expect(nextDay.body.warnings).toEqual([]);
      expect(nextDay.body).not.toHaveProperty("warningMetadata");
    });

    it("warns when moving or assigning a trip onto a taken vehicle or driver", async () => {
      const vehicle = await truck();
      const first = await planned({
        plannedAssetId: vehicle,
        plannedDriverPersonId: otherDriverPersonId,
        plannedStartAt: "2026-11-12T08:00:00+01:00",
        plannedEndAt: "2026-11-12T12:00:00+01:00",
      });
      const second = await planned({ plannedStartAt: "2026-11-13T08:00:00+01:00" });
      const assigned = await api.send(
        admin.token,
        "assign-trip",
        { activityId: second, plannedAssetId: vehicle, plannedDriverPersonId: otherDriverPersonId },
        { expectedVersion: 1 },
      );
      expect(assigned.body.warnings).toEqual([]);

      const moved = await api.send(
        admin.token,
        "reschedule-trip",
        {
          activityId: second,
          plannedStartAt: "2026-11-12T11:00:00+01:00",
          plannedEndAt: "2026-11-12T15:00:00+01:00",
        },
        { expectedVersion: 2 },
      );
      expect(moved.body.warnings).toEqual(["VEHICLE_DOUBLE_BOOKED", "DRIVER_DOUBLE_BOOKED"]);
      expect(moved.body).toMatchObject({
        warningMetadata: {
          VEHICLE_DOUBLE_BOOKED: { tripIds: [first] },
          DRIVER_DOUBLE_BOOKED: { tripIds: [first] },
        },
      });
    });

    it("counts a running trip until its planned end or now, whichever is later", async () => {
      const vehicle = await truck();
      const running = await started(vehicle, "2026-01-05T07:00:00+01:00");
      // Started in January with no planned end: it still holds the truck now.
      // An hour back, so the database clock and this one need not agree to the millisecond.
      const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const today = await plan({ plannedAssetId: vehicle, plannedStartAt: anHourAgo });
      expect(today.body).toMatchObject({
        warnings: ["VEHICLE_DOUBLE_BOOKED"],
        warningMetadata: { VEHICLE_DOUBLE_BOOKED: { tripIds: [running] } },
      });
    });

    it("warns VEHICLE_GROUNDED only while Maintenance is on", async () => {
      const vehicle = await truck();
      await api.ok(admin.token, "report-issue", {
        issueId: randomUUID(),
        assetId: vehicle,
        description: "Freins qui lâchent",
        safetyCritical: true,
      });
      const booked = await plan({ plannedAssetId: vehicle, plannedStartAt: "2026-11-20T07:00:00+01:00" });
      expect(booked.body.warnings).toEqual(["VEHICLE_GROUNDED"]);

      await api.ok(director.token, "disable-module", { moduleCode: "MAINTENANCE" });
      try {
        const off = await plan({ plannedAssetId: vehicle, plannedStartAt: "2026-11-21T07:00:00+01:00" });
        expect(off.body.warnings).toEqual([]);
      } finally {
        await api.ok(director.token, "enable-module", { moduleCode: "MAINTENANCE" });
      }
    });
  });

  describe("a start that meets a changed trip (ADR-0012 §5)", () => {
    for (const origin of ["HUMAN_UI", "OFFLINE_SYNC"] as const) {
      it(`${origin}: a reassigned trip starts with the vehicle that left, off plan`, async () => {
        const planned1 = await truck();
        const left = await truck();
        const id = await planned({ plannedAssetId: planned1, plannedDriverPersonId: driverPersonId });
        const reply = await api.send(
          admin.token,
          "start-planned-trip",
          startPayload(id, left, {
            crew: [{ activityPersonId: randomUUID(), personId: otherDriverPersonId, role: "DRIVER" }],
          }),
          { origin },
        );
        expect(reply.body).toMatchObject({ recordStatus: "OPEN", warnings: ["TRIP_STARTED_OFF_PLAN"] });
        expect((await trip(id)).discrepancyCodes).toEqual([]);
      });

      it(`${origin}: a trip already started by someone else is refused`, async () => {
        const id = await started();
        const reply = await api.send(admin.token, "start-planned-trip", startPayload(id, await truck()), {
          origin,
        });
        expect(reply.body.error).toMatchObject({ code: "INVALID_STATE_TRANSITION", metadata: { from: "OPEN" } });
      });
    }

    it("HUMAN_UI: a cancelled trip is refused", async () => {
      const id = await cancelled();
      const reply = await api.send(admin.token, "start-planned-trip", startPayload(id, await truck()));
      expect(reply.body.error).toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        metadata: { from: "CANCELLED", to: "OPEN" },
      });
    });

    it("OFFLINE_SYNC: a cancelled trip is revived, keeping its cancellation and the discrepancy", async () => {
      const id = await cancelled();
      const reply = await api.send(admin.token, "start-planned-trip", startPayload(id, await truck()), {
        origin: "OFFLINE_SYNC",
      });
      expect(reply.body).toMatchObject({
        recordStatus: "OPEN",
        warnings: ["TRIP_STARTED_AFTER_CANCELLATION"],
      });
      expect(await trip(id)).toMatchObject({
        status: "OPEN",
        cancellationReason: "CUSTOMER_CANCELLED",
        discrepancyCodes: ["TRIP_STARTED_AFTER_CANCELLATION"],
      });
    });

    it("a driver reassigned away starts offline, but not live", async () => {
      const vehicle = await truck();
      const id = await planned({ plannedAssetId: vehicle, plannedDriverPersonId: driverPersonId });
      await api.ok(
        admin.token,
        "assign-trip",
        { activityId: id, plannedAssetId: vehicle, plannedDriverPersonId: otherDriverPersonId },
        { expectedVersion: 1 },
      );
      const live = await api.send(driver.token, "start-planned-trip", startPayload(id, vehicle));
      expect(live.body.error?.code).toBe("OWN_RECORDS_ONLY");

      const offline = await api.send(driver.token, "start-planned-trip", startPayload(id, vehicle), {
        origin: "OFFLINE_SYNC",
      });
      expect(offline.body).toMatchObject({ recordStatus: "OPEN" });
    });
  });

  describe("the trip commands that already exist", () => {
    for (const [label, make] of [
      ["PLANNED", () => planned()],
      ["CANCELLED", () => cancelled()],
    ] as const) {
      it(`refuse a ${label} trip: legs, readings, substitution and close`, async () => {
        const id = await make();
        const vehicle = await truck();
        const { rowVersion } = await trip(id);
        const replies = {
          leg: await api.send(admin.token, "record-movement-leg", {
            legId: randomUUID(),
            activityId: id,
            legNo: 1,
            origin: { kind: "text", text: "Douala" },
            destination: { kind: "text", text: "Yaoundé" },
          }),
          reading: await api.send(admin.token, "record-meter-reading", {
            readingId: randomUUID(),
            assetId: vehicle,
            readingType: "ODOMETER",
            value: 1000,
            observedAt: "2026-11-05T07:00:00+01:00",
            activityId: id,
          }),
          substitution: await api.send(
            admin.token,
            "substitute-asset",
            {
              activityId: id,
              outgoingSegmentId: randomUUID(),
              newSegmentId: randomUUID(),
              substituteAssetId: vehicle,
              handoverAt: "2026-11-05T12:00:00+01:00",
            },
            { expectedVersion: 1 },
          ),
          close: await api.send(admin.token, "close-activity", { activityId: id }, { expectedVersion: rowVersion }),
        };
        for (const [command, reply] of Object.entries(replies)) {
          expect(reply.status, command).toBe(409);
          expect(reply.body.error?.code, command).toBe("INVALID_STATE_TRANSITION");
        }
      });
    }

    it("create-activity.v1 still records a started trip directly, with Scheduling on or off", async () => {
      const vehicle = await truck();
      const id = randomUUID();
      await api.ok(admin.token, "create-activity", {
        activityId: id,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: vehicle,
        startedAt: "2026-11-05T07:00:00+01:00",
      });
      expect(await trip(id)).toMatchObject({
        status: "OPEN",
        startedAt: new Date("2026-11-05T06:00:00Z"),
        plannedStartAt: null,
        plannedAssetId: null,
        priceCurrency: "XAF",
        discrepancyCodes: [],
      });
    });
  });

  describe("with Scheduling off", () => {
    it("is off by default, and refuses all six commands MODULE_DISABLED", async () => {
      const other = await seedWorkspace(ctx.db);
      const otherAdmin = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });
      const me = await api.get(otherAdmin.token, "/v1/me");
      expect((me.body as { enabledModules: string[] }).enabledModules).not.toContain("SCHEDULING");

      const id = randomUUID();
      const requests: Array<[string, Record<string, unknown>]> = [
        [
          "plan-trip",
          {
            activityId: id,
            branchCode: "DLA",
            activityTypeCode: "HAULAGE_JOB",
            templateCode: "TRUCKING",
            plannedStartAt: "2026-11-05T07:00:00+01:00",
          },
        ],
        ...(await edits(id)),
        ["start-planned-trip", startPayload(id, randomUUID())],
      ];
      for (const [name, payload] of requests) {
        const reply = await api.send(otherAdmin.token, name, payload, { expectedVersion: 1 });
        expect(reply.status, name).toBe(403);
        expect(reply.body.error, name).toEqual({ code: "MODULE_DISABLED", metadata: { module: "SCHEDULING" } });
      }
    });
  });
});
