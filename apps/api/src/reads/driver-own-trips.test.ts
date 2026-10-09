import { randomUUID } from "node:crypto";
import {
  activityDetail,
  activityListResponse,
  activitySummary,
  assetDetail,
  historyListResponse,
  vehicleHistoryResponse,
} from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { persons } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * #545: a driver reads their own trips, never the branch's (roles-and-access.md,
 * Chauffeur "sees own records"). Own is ADR-0012 §3's rule, the one the
 * commands act on: recorded by them, planned for them, or on the crew as
 * DRIVER. Moussa and Paul drive for the same Douala branch; each sees only
 * the trips that are theirs, in every read that returns trips.
 */
describe("a driver reads only their own trips (#545)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let moussa: Actor;
  let paul: Actor;
  let moussaPersonId: string;
  let paulPersonId: string;
  let truckId: string;

  /** Trips by how they are Moussa's, or not. */
  const trip = {
    recordedByMoussa: randomUUID(),
    moussaOnCrew: randomUUID(),
    plannedForMoussa: randomUUID(),
    moussaAsAssistant: randomUUID(),
    recordedByPaul: randomUUID(),
    paulOnCrew: randomUUID(),
  };
  let paulLegId: string;
  let paulSegmentId: string;

  async function person(displayName: string, membershipId: string): Promise<string> {
    const personId = randomUUID();
    await api.ok(admin.token, "register-person", {
      personId,
      displayName,
      branchCode: "DLA",
      defaultRole: "DRIVER",
    });
    // App Access links the Person to the login (ADR-0010).
    await ctx.db.update(persons).set({ membershipId }).where(eq(persons.id, personId));
    return personId;
  }

  async function recordTrip(
    token: string,
    activityId: string,
    opts: { crew?: Array<{ personId: string; role: string }>; segmentId?: string } = {},
  ) {
    await api.ok(token, "create-activity", {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: opts.segmentId ?? randomUUID(),
      primaryAssetId: truckId,
      startedAt: "2026-10-06T06:00:00Z",
      customerName: `Customer ${activityId.slice(0, 4)}`,
      ...(opts.crew === undefined
        ? {}
        : {
            crew: opts.crew.map((member) => ({ activityPersonId: randomUUID(), ...member })),
          }),
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    const director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    moussa = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    paul = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    await api.ok(director.token, "enable-module", { moduleCode: "SCHEDULING" });

    moussaPersonId = await person("Moussa Bello", moussa.membershipId);
    paulPersonId = await person("Paul Etoundi", paul.membershipId);
    truckId = await seedAsset(ctx.app, admin.token, { assetCode: "OWN-TRUCK" });

    await recordTrip(moussa.token, trip.recordedByMoussa);
    await recordTrip(admin.token, trip.moussaOnCrew, {
      crew: [{ personId: moussaPersonId, role: "DRIVER" }],
    });
    // Booked for Moussa, then started by the office with no crew: the plan
    // alone makes it his.
    await api.ok(admin.token, "plan-trip", {
      activityId: trip.plannedForMoussa,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      plannedStartAt: "2026-10-06T07:00:00+01:00",
      plannedDriverPersonId: moussaPersonId,
    });
    await api.ok(admin.token, "start-planned-trip", {
      activityId: trip.plannedForMoussa,
      primarySegmentId: randomUUID(),
      primaryAssetId: truckId,
      startedAt: "2026-10-06T07:20:00+01:00",
    });
    await recordTrip(admin.token, trip.moussaAsAssistant, {
      crew: [{ personId: moussaPersonId, role: "ASSISTANT" }],
    });
    paulSegmentId = randomUUID();
    await recordTrip(paul.token, trip.recordedByPaul, { segmentId: paulSegmentId });
    await recordTrip(admin.token, trip.paulOnCrew, {
      crew: [{ personId: paulPersonId, role: "DRIVER" }],
    });

    paulLegId = randomUUID();
    await api.ok(paul.token, "record-movement-leg", {
      legId: paulLegId,
      activityId: trip.recordedByPaul,
      legNo: 1,
      segmentId: paulSegmentId,
      origin: { kind: "text", text: "Douala" },
      destination: { kind: "text", text: "Edéa" },
      distanceKm: 68,
      loadState: "LADEN",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function listIds(actor: Actor, query = ""): Promise<string[]> {
    const response = await api.get(actor.token, `/v1/activities?limit=100${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return activityListResponse.parse(response.body).items.map((item) => item.id).sort();
  }

  const moussasTrips = [trip.recordedByMoussa, trip.moussaOnCrew, trip.plannedForMoussa].sort();
  const paulsTrips = [trip.recordedByPaul, trip.paulOnCrew].sort();
  const notMoussas = [trip.moussaAsAssistant, trip.recordedByPaul, trip.paulOnCrew];

  it("lists a driver's own trips and no one else's", async () => {
    expect(await listIds(moussa)).toEqual(moussasTrips);
    expect(await listIds(paul)).toEqual(paulsTrips);
    // Filters narrow inside the driver's trips, never past them.
    expect(await listIds(paul, `&assetId=${truckId}`)).toEqual(paulsTrips);
    // The office keeps the whole branch.
    expect(await listIds(admin)).toEqual([...moussasTrips, ...notMoussas].sort());
  });

  it("answers a trip that is not the driver's like one that does not exist", async () => {
    for (const id of moussasTrips) {
      const response = await api.get(moussa.token, `/v1/activities/${id}`);
      expect(response.status, id).toBe(200);
      expect(activityDetail.parse(response.body).id).toBe(id);
    }
    for (const id of notMoussas) {
      const response = await api.get(moussa.token, `/v1/activities/${id}`);
      expect(response.status, id).toBe(404);
      expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    }
    expect((await api.get(admin.token, `/v1/activities/${trip.recordedByPaul}`)).status).toBe(200);
  });

  it("counts the driver's own trips in the summary tiles", async () => {
    const summary = async (actor: Actor) => {
      const response = await api.get(actor.token, "/v1/activities/summary");
      expect(response.status).toBe(200);
      return activitySummary.parse(response.body);
    };
    // Moussa recorded one, is crewed on one and was planned on one: all OPEN.
    expect((await summary(moussa)).open).toBe(3);
    expect((await summary(paul)).open).toBe(2);
    expect((await summary(admin)).open).toBe(6);
  });

  it("shows only the driver's own trips among the vehicle's recent trips", async () => {
    const recent = async (actor: Actor) => {
      const response = await api.get(actor.token, `/v1/assets/${truckId}`);
      expect(response.status).toBe(200);
      return assetDetail.parse(response.body).recentActivities.map((row) => row.id).sort();
    };
    expect(await recent(moussa)).toEqual(moussasTrips);
    expect(await recent(paul)).toEqual(paulsTrips);
    expect((await recent(admin)).length).toBe(6);
  });

  it("keeps other drivers' trips out of the vehicle timeline", async () => {
    const tripSubjects = async (actor: Actor) => {
      const response = await api.get(actor.token, `/v1/assets/${truckId}/history?limit=100&kind=TRIPS`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return vehicleHistoryResponse.parse(response.body).items.map((item) => item.subject);
    };
    const moussaSees = await tripSubjects(moussa);
    const moussaTripIds = new Set(
      moussaSees.filter((subject) => subject.entityType === "activity").map((subject) => subject.id),
    );
    expect([...moussaTripIds].sort()).toEqual(moussasTrips);
    expect(moussaSees.map((subject) => subject.id)).not.toContain(paulLegId);

    const paulSees = await tripSubjects(paul);
    expect(paulSees.map((subject) => subject.id)).toContain(paulLegId);
  });

  it("opens the record history of the driver's own trips and their legs only", async () => {
    const history = (actor: Actor, type: string, id: string) =>
      api.get(actor.token, `/v1/history/${type}/${id}`);

    const own = await history(moussa, "activity", trip.moussaOnCrew);
    expect(own.status).toBe(200);
    expect(historyListResponse.parse(own.body).items.length).toBeGreaterThan(0);

    for (const [type, id] of [
      ["activity", trip.recordedByPaul],
      ["movement_leg", paulLegId],
      ["activity_asset_segment", paulSegmentId],
    ] as const) {
      expect((await history(moussa, type, id)).status, type).toBe(404);
      expect((await history(paul, type, id)).status, type).toBe(200);
    }
  });

  it("agrees with the commands: what a driver cannot see, they cannot close", async () => {
    const refused = await api.send(
      moussa.token,
      "close-activity",
      { activityId: trip.recordedByPaul, endedAt: "2026-10-06T18:00:00Z" },
      { expectedVersion: 1 },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe("OWN_RECORDS_ONLY");

    // Crewed as DRIVER is own for both sides: listed above, and closable here.
    const detail = activityDetail.parse(
      (await api.get(moussa.token, `/v1/activities/${trip.moussaOnCrew}`)).body,
    );
    await api.ok(
      moussa.token,
      "close-activity",
      { activityId: trip.moussaOnCrew, endedAt: "2026-10-06T18:00:00Z" },
      { expectedVersion: detail.rowVersion },
    );
  });
});
