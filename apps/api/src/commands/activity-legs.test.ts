import { randomUUID } from "node:crypto";
import {
  createActivityCommand,
  recordMeterReadingCommand,
  recordMovementLegCommand,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, meterReadings, movementLegs, places } from "../db/schema.js";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("record-movement-leg.v1 / record-meter-reading.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let token: string;
  let truckId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const member = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    token = (await createSession(ctx.db, { workspaceId, principalId: member.principal.id }))
      .token;
    truckId = await seedAsset(ctx.app, token, { assetCode: "LEG-TRUCK" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function newActivity(): Promise<string> {
    const activityId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/create-activity",
      headers: { authorization: `Bearer ${token}` },
      payload: createActivityCommand.parse({
        name: "create-activity",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          activityId,
          branchCode: "DLA",
          activityTypeCode: "HAULAGE_JOB",
          templateCode: "TRUCKING",
          primarySegmentId: randomUUID(),
          primaryAssetId: truckId,
          startedAt: "2026-07-14T06:10:00Z",
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    return activityId;
  }

  function postLeg(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-movement-leg",
      headers: { authorization: `Bearer ${token}` },
      payload: recordMovementLegCommand.parse({
        name: "record-movement-leg",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      }),
    });
  }

  function postReading(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-meter-reading",
      headers: { authorization: `Bearer ${token}` },
      payload: recordMeterReadingCommand.parse({
        name: "record-meter-reading",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      }),
    });
  }

  it("registers named places on first use and reuses them after", async () => {
    const activityId = await newActivity();
    const legId = randomUUID();
    const response = await postLeg({
      legId,
      activityId,
      legNo: 1,
      origin: { kind: "place", placeId: randomUUID(), name: "Douala" },
      destination: { kind: "place", placeId: randomUUID(), name: "Yaoundé" },
      departedAt: "2026-07-14T06:10:00Z",
      arrivedAt: "2026-07-14T11:30:00Z",
      distanceKm: 245,
      loadState: "LADEN",
    });
    expect(response.statusCode).toBe(200);

    const [leg] = await ctx.db.select().from(movementLegs).where(eq(movementLegs.id, legId));
    expect(leg?.originPlaceId).not.toBeNull();
    expect(leg?.destinationPlaceId).not.toBeNull();
    expect(leg).toMatchObject({ distanceKm: 245, loadState: "LADEN" });

    // A second leg naming Yaoundé must not create a second Yaoundé.
    await postLeg({
      legId: randomUUID(),
      activityId,
      legNo: 2,
      origin: { kind: "place", placeId: randomUUID(), name: "yaoundé" },
      destination: { kind: "place", placeId: randomUUID(), name: "Bertoua" },
      distanceKm: 345,
    });
    const yaounde = await ctx.db
      .select()
      .from(places)
      .where(
        and(eq(places.workspaceId, workspaceId), eq(places.normalizedName, "yaoundé")),
      );
    expect(yaounde).toHaveLength(1);
  });

  it("accepts a free-text endpoint for an ad-hoc stop", async () => {
    const activityId = await newActivity();
    const legId = randomUUID();
    const response = await postLeg({
      legId,
      activityId,
      legNo: 1,
      origin: { kind: "place", placeId: randomUUID(), name: "Bertoua" },
      destination: { kind: "text", text: "Carrière PK12, route de Garoua-Boulaï" },
    });
    expect(response.statusCode).toBe(200);

    const [leg] = await ctx.db.select().from(movementLegs).where(eq(movementLegs.id, legId));
    expect(leg?.destinationPlaceId).toBeNull();
    expect(leg?.destinationText).toBe("Carrière PK12, route de Garoua-Boulaï");
  });

  it("keeps leg numbers unique within an activity", async () => {
    const activityId = await newActivity();
    const leg = {
      activityId,
      legNo: 1,
      origin: { kind: "text", text: "A" },
      destination: { kind: "text", text: "B" },
    };
    expect((await postLeg({ ...leg, legId: randomUUID() })).statusCode).toBe(200);

    const duplicate = await postLeg({ ...leg, legId: randomUUID() });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: { code: "UNIQUE_CONSTRAINT_VIOLATION" },
    });
  });

  it("refuses to append to a closed job — reopening is the ceremony", async () => {
    const activityId = await newActivity();
    await ctx.db
      .update(activities)
      .set({ status: "CLOSED", completeness: "COMPLETE" })
      .where(eq(activities.id, activityId));

    const response = await postLeg({
      legId: randomUUID(),
      activityId,
      legNo: 9,
      origin: { kind: "text", text: "A" },
      destination: { kind: "text", text: "B" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION" },
    });
  });

  it("warns on a decreasing odometer without refusing the observation", async () => {
    const first = await postReading({
      readingId: randomUUID(),
      assetId: truckId,
      readingType: "ODOMETER",
      value: 412_880,
      observedAt: "2026-07-14T06:10:00Z",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().warnings).toEqual([]);

    // §3.1: decreases warn, never silently accepted. §6: the server does not get
    // to reject a fact the field reported.
    const backwards = await postReading({
      readingId: randomUUID(),
      assetId: truckId,
      readingType: "ODOMETER",
      value: 400_000,
      observedAt: "2026-07-14T18:00:00Z",
    });
    expect(backwards.statusCode).toBe(200);
    expect(backwards.json().warnings).toContain("METER_READING_DECREASED");
  });

  it("tracks engine hours as a separate meter from the odometer", async () => {
    const response = await postReading({
      readingId: randomUUID(),
      assetId: truckId,
      readingType: "HOURS",
      value: 4_812,
      observedAt: "2026-07-08T08:00:00Z",
    });
    expect(response.statusCode).toBe(200);
    // Hours start far below the odometer and must not read as a decrease.
    expect(response.json().warnings).toEqual([]);
  });

  it("corrects by superseding, leaving the original observation intact", async () => {
    const originalId = randomUUID();
    const correctionId = randomUUID();
    await postReading({
      readingId: originalId,
      assetId: truckId,
      readingType: "ODOMETER",
      value: 999_111,
      observedAt: "2026-07-20T06:00:00Z",
    });

    const correction = await postReading({
      readingId: correctionId,
      assetId: truckId,
      readingType: "ODOMETER",
      value: 999_211,
      observedAt: "2026-07-20T06:00:00Z",
      supersedesReadingId: originalId,
      supersedeReason: "Chiffre mal recopié sur la feuille de route",
    });
    expect(correction.statusCode).toBe(200);

    const [original] = await ctx.db
      .select()
      .from(meterReadings)
      .where(eq(meterReadings.id, originalId));
    expect(original).toMatchObject({
      // The observation itself is untouched — only the supersede link is written.
      value: 999_111n,
      supersededById: correctionId,
      supersedeReason: "Chiffre mal recopié sur la feuille de route",
    });
  });

  it("supersedes a reading at most once", async () => {
    const originalId = randomUUID();
    await postReading({
      readingId: originalId,
      assetId: truckId,
      readingType: "ODOMETER",
      value: 888_000,
      observedAt: "2026-07-21T06:00:00Z",
    });
    const first = await postReading({
      readingId: randomUUID(),
      assetId: truckId,
      readingType: "ODOMETER",
      value: 888_100,
      observedAt: "2026-07-21T06:00:00Z",
      supersedesReadingId: originalId,
      supersedeReason: "première correction",
    });
    expect(first.statusCode).toBe(200);

    const second = await postReading({
      readingId: randomUUID(),
      assetId: truckId,
      readingType: "ODOMETER",
      value: 888_200,
      observedAt: "2026-07-21T06:00:00Z",
      supersedesReadingId: originalId,
      supersedeReason: "deuxième correction",
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION" },
    });
  });

  it("requires a reason to supersede", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-meter-reading",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "record-meter-reading",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          sourceArtifactIds: [],
        },
        payload: {
          readingId: randomUUID(),
          assetId: truckId,
          readingType: "ODOMETER",
          value: 1,
          observedAt: "2026-07-22T06:00:00Z",
          source: "MANUAL",
          supersedesReadingId: randomUUID(),
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  /**
   * The workshop reads the odometer when a truck comes in. The handler always
   * accepted the role; without a default rule every such reading answered 403
   * APPROVAL_REQUIRED (step 2 of #44, owner's role rules).
   */
  it("accepts a standalone reading from the maintenance role", async () => {
    const mechanic = await seedMember(ctx.db, {
      workspaceId,
      role: "MAINTENANCE",
      allBranches: true,
    });
    const mechanicToken = (
      await createSession(ctx.db, { workspaceId, principalId: mechanic.principal.id })
    ).token;
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-meter-reading",
      headers: { authorization: `Bearer ${mechanicToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          readingId: randomUUID(),
          assetId: truckId,
          readingType: "ODOMETER",
          value: 512_300,
          observedAt: "2026-08-01T07:30:00Z",
        },
      },
    });
    expect(response.statusCode).toBe(200);
  });
});
