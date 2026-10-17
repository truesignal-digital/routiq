import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { persons } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";
import { currentPeriodCode } from "./periods.js";

/**
 * #592: a driver writes onto their own trips only. Every command that names a
 * trip applies `assertOwnTrip` (ADR-0012 §3), the rule the reads narrow by
 * (#545), so a driver cannot put a leg, a reading or money onto a trip they
 * cannot see. Moussa and Paul drive for the same Douala branch.
 *
 * Offline replays get §5's latitude: a driver who was the planned driver at
 * any point may still file facts on the trip after a reassignment.
 */
describe("a driver writes onto their own trips only (#592)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let moussa: Actor;
  let paul: Actor;
  let moussaPersonId: string;
  let paulPersonId: string;
  let truckId: string;
  const economicDate = `${currentPeriodCode(new Date(), "Africa/Douala")}-15`;

  const moussasTrip = randomUUID();
  const paulsTrip = randomUUID();
  /** Planned for Moussa, reassigned to Paul, then started by the office. */
  const reassignedTrip = randomUUID();
  const reassignedSegment = randomUUID();

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

  async function recordTrip(token: string, activityId: string) {
    await api.ok(token, "create-activity", {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: truckId,
      startedAt: "2026-10-06T06:00:00Z",
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    moussa = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    paul = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    await setModule(ctx.db, workspaceId, "SCHEDULING", true);

    moussaPersonId = await person("Moussa Bello", moussa.membershipId);
    paulPersonId = await person("Paul Etoundi", paul.membershipId);
    truckId = await seedAsset(ctx.app, admin.token, { assetCode: "OWN-W-TRUCK" });

    await recordTrip(moussa.token, moussasTrip);
    await recordTrip(paul.token, paulsTrip);

    await api.ok(admin.token, "plan-trip", {
      activityId: reassignedTrip,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      plannedStartAt: "2026-10-06T07:00:00+01:00",
      plannedDriverPersonId: moussaPersonId,
    });
    await api.ok(
      admin.token,
      "assign-trip",
      { activityId: reassignedTrip, plannedAssetId: null, plannedDriverPersonId: paulPersonId },
      { expectedVersion: 1 },
    );
    await api.ok(admin.token, "start-planned-trip", {
      activityId: reassignedTrip,
      primarySegmentId: reassignedSegment,
      primaryAssetId: truckId,
      startedAt: "2026-10-06T07:20:00+01:00",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const leg = (activityId: string) => ({
    legId: randomUUID(),
    activityId,
    legNo: Math.floor(Math.random() * 1_000_000) + 1,
    origin: { kind: "text", text: "Douala" },
    destination: { kind: "text", text: "Edéa" },
    distanceKm: 68,
  });

  const reading = (activityId: string) => ({
    readingId: randomUUID(),
    assetId: truckId,
    readingType: "ODOMETER",
    value: 120_000,
    observedAt: "2026-10-06T09:00:00+01:00",
    activityId,
  });

  const expense = (activityIds: string[], amountMinor = 20_000) => ({
    entryId: randomUUID(),
    branchCode: "DLA",
    categoryCode: "FUEL",
    economicDate,
    amountMinor: amountMinor * activityIds.length,
    paymentMethod: "CASH",
    postings: activityIds.map((activityId) => ({ assetId: truckId, activityId, amountMinor })),
  });

  function expectOwnRecordsOnly(reply: Awaited<ReturnType<typeof api.send>>, label: string) {
    expect(reply.status, `${label}: ${JSON.stringify(reply.body)}`).toBe(403);
    expect(reply.body.error?.code, label).toBe("OWN_RECORDS_ONLY");
  }

  describe("record-movement-leg", () => {
    it("refuses a leg on another driver's trip", async () => {
      expectOwnRecordsOnly(await api.send(moussa.token, "record-movement-leg", leg(paulsTrip)), "leg");
    });

    it("records a leg on the driver's own trip", async () => {
      await api.ok(moussa.token, "record-movement-leg", leg(moussasTrip));
    });
  });

  describe("record-meter-reading on a trip", () => {
    it("refuses a reading filed on another driver's trip", async () => {
      expectOwnRecordsOnly(
        await api.send(moussa.token, "record-meter-reading", reading(paulsTrip)),
        "reading",
      );
    });

    it("records a reading on the driver's own trip, and one with no trip", async () => {
      await api.ok(moussa.token, "record-meter-reading", reading(moussasTrip));
      const { activityId: _trip, ...onVehicleOnly } = reading(paulsTrip);
      await api.ok(moussa.token, "record-meter-reading", onVehicleOnly);
    });
  });

  describe("record-expense with a trip line", () => {
    it("refuses an expense on another driver's trip, alone or beside the driver's own", async () => {
      expectOwnRecordsOnly(await api.send(moussa.token, "record-expense", expense([paulsTrip])), "alone");
      expectOwnRecordsOnly(
        await api.send(moussa.token, "record-expense", expense([moussasTrip, paulsTrip])),
        "beside own",
      );
    });

    it("records an expense on the driver's own trip", async () => {
      const reply = await api.ok(moussa.token, "record-expense", expense([moussasTrip]));
      expect(reply.recordStatus).toBe("POSTED");
    });

    it("still answers an unknown trip as not found", async () => {
      const reply = await api.send(moussa.token, "record-expense", expense([randomUUID()]));
      expect(reply.status).toBe(422);
      expect(reply.body.error?.code).toBe("REFERENCE_NOT_FOUND");
    });
  });

  describe("update-pending-entry", () => {
    it("refuses moving a pending expense onto another driver's trip", async () => {
      // Above the 100 000 band a driver's expense waits for approval.
      const pending = expense([moussasTrip], 150_000);
      const recorded = await api.ok(moussa.token, "record-expense", pending);
      expect(recorded.recordStatus).toBe("SUBMITTED");

      const edit = (activityId: string) =>
        api.send(
          moussa.token,
          "update-pending-entry",
          {
            entryId: pending.entryId,
            categoryCode: "FUEL",
            economicDate,
            paymentMethod: "CASH",
            amountMinor: 160_000,
            postings: [{ assetId: truckId, activityId, amountMinor: 160_000 }],
          },
          { expectedVersion: 1 },
        );
      expectOwnRecordsOnly(await edit(paulsTrip), "edit onto Paul's trip");
      const own = await edit(moussasTrip);
      expect(own.status, JSON.stringify(own.body)).toBe(200);
    });
  });

  it("leaves the office free to write onto any driver's trip", async () => {
    await api.ok(admin.token, "record-movement-leg", leg(paulsTrip));
    await api.ok(admin.token, "record-meter-reading", reading(paulsTrip));
    await api.ok(admin.token, "record-expense", expense([paulsTrip, moussasTrip]));
  });

  describe("offline replay on a trip reassigned away (ADR-0012 §5)", () => {
    it("refuses Moussa's live facts but accepts the same facts replayed offline", async () => {
      expectOwnRecordsOnly(
        await api.send(moussa.token, "record-movement-leg", leg(reassignedTrip)),
        "live leg",
      );
      expectOwnRecordsOnly(
        await api.send(moussa.token, "record-meter-reading", reading(reassignedTrip)),
        "live reading",
      );
      expectOwnRecordsOnly(
        await api.send(moussa.token, "record-expense", expense([reassignedTrip])),
        "live expense",
      );

      const offline = { origin: "OFFLINE_SYNC" };
      await api.ok(moussa.token, "record-movement-leg", leg(reassignedTrip), offline);
      await api.ok(moussa.token, "record-meter-reading", reading(reassignedTrip), offline);
      await api.ok(moussa.token, "record-expense", expense([reassignedTrip]), offline);
    });

    it("never stretches to a trip the driver was never planned on", async () => {
      expectOwnRecordsOnly(
        await api.send(moussa.token, "record-movement-leg", leg(paulsTrip), { origin: "OFFLINE_SYNC" }),
        "offline leg on Paul's own trip",
      );
    });

    it("lets a substitution replayed offline through, but not a live one", async () => {
      const substitute = await seedAsset(ctx.app, admin.token, { assetCode: "OWN-W-SPARE" });
      const payload = {
        activityId: reassignedTrip,
        outgoingSegmentId: reassignedSegment,
        newSegmentId: randomUUID(),
        substituteAssetId: substitute,
        handoverAt: "2026-10-06T12:00:00+01:00",
      };
      expectOwnRecordsOnly(
        await api.send(moussa.token, "substitute-asset", payload, { expectedVersion: 1 }),
        "live substitution",
      );
      await api.ok(moussa.token, "substitute-asset", payload, {
        expectedVersion: 1,
        origin: "OFFLINE_SYNC",
      });
    });
  });
});
