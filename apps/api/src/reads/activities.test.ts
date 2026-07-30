import { randomUUID } from "node:crypto";
import {
  activityDetail,
  activityListResponse,
  personListResponse,
  placeListResponse,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("activity, person and place reads", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let adminToken: string;
  let doualaToken: string;
  let doualaBranchId: string;
  let yaoundeBranchId: string;
  let primaryAssetId: string;
  let trailerAssetId: string;
  let yaoundeAssetId: string;
  let driverId: string;
  let openActivityId: string;
  let openSegmentId: string;
  let closedActivityId: string;
  let yaoundeActivityId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    doualaBranchId = seeded.branch.id;

    const [yaounde] = await ctx.db
      .insert(branches)
      .values({
        workspaceId: seeded.workspace.id,
        code: "YDE",
        name: "Yaoundé",
      })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");
    yaoundeBranchId = yaounde.id;

    const admin = await seedMember(ctx.db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(ctx.db, {
        workspaceId: seeded.workspace.id,
        principalId: admin.principal.id,
      })
    ).token;

    const doualaMember = await seedMember(ctx.db, {
      workspaceId: seeded.workspace.id,
      role: "OPS_MANAGER",
      branchIds: [doualaBranchId],
    });
    doualaToken = (
      await createSession(ctx.db, {
        workspaceId: seeded.workspace.id,
        principalId: doualaMember.principal.id,
      })
    ).token;

    primaryAssetId = await seedAsset(ctx.app, adminToken, {
      assetCode: "ACT-TRACTOR",
    });
    trailerAssetId = await seedAsset(ctx.app, adminToken, {
      assetCode: "ACT-TRAILER",
    });
    yaoundeAssetId = await seedAsset(ctx.app, adminToken, {
      assetCode: "ACT-YDE",
      branchCode: "YDE",
    });

    driverId = randomUUID();
    await command("register-person", {
      personId: driverId,
      displayName: "Abdoulaye Sanda",
      personCode: "DRV-014",
      branchCode: "DLA",
      defaultRole: "DRIVER",
    });

    openActivityId = randomUUID();
    openSegmentId = randomUUID();
    await command("create-activity", {
      activityId: openActivityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: openSegmentId,
      primaryAssetId,
      startedAt: "2026-07-20T06:00:00Z",
      customerName: "Open Customer",
      clientReference: "OPEN-REF",
      startReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER",
        value: 412_880,
        observedAt: "2026-07-20T06:00:00Z",
      },
      crew: [
        {
          activityPersonId: randomUUID(),
          personId: driverId,
          role: "DRIVER",
        },
      ],
    });

    const doualaPlaceId = randomUUID();
    const edeaPlaceId = randomUUID();
    await command("record-movement-leg", {
      legId: randomUUID(),
      activityId: openActivityId,
      legNo: 2,
      segmentId: openSegmentId,
      origin: { kind: "place", placeId: edeaPlaceId, name: "Edéa" },
      destination: { kind: "text", text: "Kribi customer site" },
      distanceKm: 116,
      loadState: "LADEN",
    });
    await command("record-movement-leg", {
      legId: randomUUID(),
      activityId: openActivityId,
      legNo: 1,
      segmentId: openSegmentId,
      origin: { kind: "place", placeId: doualaPlaceId, name: "Douala" },
      destination: { kind: "place", placeId: edeaPlaceId, name: "Edéa" },
      distanceKm: 68,
      loadState: "LADEN",
    });

    closedActivityId = randomUUID();
    await command("record-haulage-job-sheet", {
      activityId: closedActivityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId,
      startedAt: "2026-07-10T06:10:00Z",
      endedAt: "2026-07-11T09:00:00Z",
      customerName: "Brasseries du Cameroun",
      clientReference: "WB-4471",
      description: "Pallet delivery",
      cargoDescription: "28 t boissons palettisées",
      cargoWeightKg: 28_000,
      startReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER",
        value: 410_000,
        observedAt: "2026-07-10T06:10:00Z",
      },
      endReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER",
        value: 411_125,
        observedAt: "2026-07-11T09:00:00Z",
      },
      crew: [
        {
          activityPersonId: randomUUID(),
          personId: driverId,
          role: "DRIVER",
        },
      ],
      extraSegments: [
        {
          segmentId: randomUUID(),
          assetId: trailerAssetId,
          role: "TRAILER",
          startedAt: "2026-07-10T06:10:00Z",
        },
      ],
      legs: [
        {
          legId: randomUUID(),
          legNo: 2,
          origin: { kind: "place", placeId: randomUUID(), name: "Yaoundé" },
          destination: {
            kind: "place",
            placeId: randomUUID(),
            name: "Ngaoundéré",
          },
          distanceKm: 880,
          loadState: "LADEN",
        },
        {
          legId: randomUUID(),
          legNo: 1,
          origin: { kind: "place", placeId: randomUUID(), name: "Douala" },
          destination: { kind: "place", placeId: randomUUID(), name: "Yaoundé" },
          distanceKm: 245,
          loadState: "LADEN",
        },
      ],
      entries: [
        {
          entryId: randomUUID(),
          direction: "REVENUE",
          categoryCode: "FREIGHT_REVENUE",
          amountMinor: 1_850_000,
          economicDate: "2026-07-11",
          paymentMethod: "BANK",
          paymentReference: "VIR-88213",
        },
      ],
    });

    yaoundeActivityId = randomUUID();
    await command("create-activity", {
      activityId: yaoundeActivityId,
      branchCode: "YDE",
      activityTypeCode: "CHARTER",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: yaoundeAssetId,
      startedAt: "2026-07-05T08:00:00Z",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function command(name: string, payload: Record<string, unknown>) {
    const response = await ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `activity-read-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `${name} failed: ${response.statusCode} ${response.body}`,
      );
    }
    return response.json();
  }

  async function list(query = "", token = adminToken) {
    const response = await ctx.app.inject({
      method: "GET",
      url: query === "" ? "/v1/activities" : `/v1/activities?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return activityListResponse.parse(response.json());
  }

  it("returns activity summaries in started-at descending order", async () => {
    const response = await list();

    expect(response.items.map((item) => item.id)).toEqual([
      openActivityId,
      closedActivityId,
      yaoundeActivityId,
    ]);
    expect(response.nextCursor).toBeNull();
    expect(response.items[0]).toMatchObject({
      activityType: {
        code: "HAULAGE_JOB",
        labelFr: expect.any(String),
        labelEn: expect.any(String),
      },
      status: "OPEN",
      completeness: null,
      completenessCodes: [],
      startedAt: "2026-07-20T06:00:00.000Z",
      endedAt: null,
      customerName: "Open Customer",
      clientReference: "OPEN-REF",
      branchId: doualaBranchId,
      primaryAssetCode: "ACT-TRACTOR",
      legCount: 2,
      crewCount: 1,
    });
  });

  it("filters by status, completeness, branch, segment asset, type and dates", async () => {
    expect((await list("status=CLOSED")).items.map((item) => item.id)).toEqual([
      closedActivityId,
    ]);
    expect(
      (await list("completeness=COMPLETE")).items.map((item) => item.id),
    ).toEqual([closedActivityId]);
    expect(
      (await list(`branchId=${yaoundeBranchId}`)).items.map((item) => item.id),
    ).toEqual([yaoundeActivityId]);
    expect(
      (await list(`assetId=${trailerAssetId}`)).items.map((item) => item.id),
    ).toEqual([closedActivityId]);
    expect(
      (await list("activityTypeCode=CHARTER")).items.map((item) => item.id),
    ).toEqual([yaoundeActivityId]);
    expect(
      (
        await list(
          "from=2026-07-09T00%3A00%3A00Z&to=2026-07-12T00%3A00%3A00Z",
        )
      ).items.map((item) => item.id),
    ).toEqual([closedActivityId]);
  });

  it("uses stable keyset pagination for activity-number sorting", async () => {
    const first = await list("sort=activityNumber%3Aasc&limit=1");
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await list(
      `sort=activityNumber%3Aasc&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    const third = await list(
      `sort=activityNumber%3Aasc&limit=1&cursor=${encodeURIComponent(second.nextCursor!)}`,
    );

    expect(
      [...first.items, ...second.items, ...third.items].map(
        (item) => item.activityNumber,
      ),
    ).toEqual(
      [...first.items, ...second.items, ...third.items]
        .map((item) => item.activityNumber)
        .sort(),
    );
    expect(third.nextCursor).toBeNull();
  });

  it("returns the complete activity detail with ordered child records", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/activities/${closedActivityId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);

    const detail = activityDetail.parse(response.json());
    expect(detail).toMatchObject({
      id: closedActivityId,
      activityType: { code: "HAULAGE_JOB" },
      templateCode: "TRUCKING",
      customValues: {
        cargoDescription: "28 t boissons palettisées",
        cargoWeightKg: 28_000,
      },
      status: "CLOSED",
      completeness: "COMPLETE",
      description: "Pallet delivery",
      primaryAssetCode: "ACT-TRACTOR",
      legCount: 2,
      crewCount: 1,
    });
    expect(
      detail.segments.map((segment) => segment.assetCode).sort(),
    ).toEqual(["ACT-TRACTOR", "ACT-TRAILER"].sort());
    // substitute-asset takes its expectedVersion from the outgoing SEGMENT, so a
    // detail read that omitted this would make the dialog unbuildable.
    for (const segment of detail.segments) {
      expect(segment.rowVersion, segment.assetCode).toBeGreaterThanOrEqual(1);
    }
    expect(detail.crew).toEqual([
      {
        personId: driverId,
        displayName: "Abdoulaye Sanda",
        role: "DRIVER",
      },
    ]);
    expect(detail.legs.map((leg) => leg.legNo)).toEqual([1, 2]);
    expect(detail.legs.map((leg) => [leg.originName, leg.destinationName])).toEqual([
      ["Douala", "Yaoundé"],
      ["Yaoundé", "Ngaoundéré"],
    ]);
    expect(detail.readings.map((reading) => reading.value)).toEqual([
      410_000,
      411_125,
    ]);
    expect(detail.financialEntries).toEqual([
      expect.objectContaining({
        direction: "REVENUE",
        categoryCode: "FREIGHT_REVENUE",
        amountMinor: 1_850_000,
        status: "POSTED",
      }),
    ]);
  });

  it("carries the open segment's rowVersion, the version substitute-asset locks on", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/activities/${openActivityId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);

    const detail = activityDetail.parse(response.json());
    const open = detail.segments.find((segment) => segment.endedAt === null);
    expect(open).toMatchObject({ id: openSegmentId, rowVersion: 1 });
  });

  it("enforces branch scope on activity lists and details", async () => {
    expect((await list("", doualaToken)).items.map((item) => item.id)).toEqual([
      openActivityId,
      closedActivityId,
    ]);

    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/activities/${yaoundeActivityId}`,
      headers: { authorization: `Bearer ${doualaToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "REFERENCE_NOT_FOUND" },
    });
  });

  it("lists and filters visible persons without pagination", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/persons?branchId=${doualaBranchId}&active=true&search=sanda`,
      headers: { authorization: `Bearer ${doualaToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(personListResponse.parse(response.json())).toEqual({
      items: [
        {
          id: driverId,
          displayName: "Abdoulaye Sanda",
          personCode: "DRV-014",
          defaultRole: "DRIVER",
          branchId: doualaBranchId,
          active: true,
        },
      ],
    });

    const inactive = await ctx.app.inject({
      method: "GET",
      url: "/v1/persons?active=false",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(personListResponse.parse(inactive.json()).items).toEqual([]);
  });

  it("lists resolved workspace places as id/name pairs", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/places",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const names = placeListResponse
      .parse(response.json())
      .items.map((place) => place.name);
    expect(names).toEqual([
      "Douala",
      "Edéa",
      "Ngaoundéré",
      "Yaoundé",
    ]);
  });

  it("rejects malformed list filters and activity ids", async () => {
    const listResponse = await ctx.app.inject({
      method: "GET",
      url: "/v1/activities?status=UNKNOWN",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listResponse.statusCode).toBe(400);

    const detailResponse = await ctx.app.inject({
      method: "GET",
      url: "/v1/activities/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(detailResponse.statusCode).toBe(400);
  });
  /**
   * Isolation proven by running it, not by reading the WHERE clauses. §3.4
   * invariant 1 is absolute, and it is the single promise that lets an operator
   * put real financials into a shared platform (§10) — a review that only reads
   * the query builder cannot tell you a filter was not dropped.
   */
  describe("tenant isolation", () => {
    let strangerToken: string;

    beforeAll(async () => {
      const other = await seedWorkspace(ctx.db);
      const member = await seedMember(ctx.db, {
        workspaceId: other.workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      strangerToken = (
        await createSession(ctx.db, {
          workspaceId: other.workspace.id,
          principalId: member.principal.id,
        })
      ).token;
    });

    it("shows another tenant none of our jobs", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/activities",
        headers: { authorization: `Bearer ${strangerToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([]);
    });

    it("refuses a direct hit on our activity id", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/v1/activities/${closedActivityId}`,
        headers: { authorization: `Bearer ${strangerToken}` },
      });
      // Knowing the uuid must not be enough.
      expect(response.statusCode).toBe(404);
    });

    it("shows another tenant none of our people or places", async () => {
      const persons = await ctx.app.inject({
        method: "GET",
        url: "/v1/persons",
        headers: { authorization: `Bearer ${strangerToken}` },
      });
      expect(persons.json().items).toEqual([]);

      const places = await ctx.app.inject({
        method: "GET",
        url: "/v1/places",
        headers: { authorization: `Bearer ${strangerToken}` },
      });
      expect(places.json().items).toEqual([]);
    });
  });

});
