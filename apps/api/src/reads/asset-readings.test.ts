import { randomUUID } from "node:crypto";
import { assetReadingsResponse, type AssetReadingItem } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

describe("GET /v1/assets/:assetId/readings", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let dlaOnly: Actor;
  let ydeOnly: Actor;
  let outsider: Actor;
  let assetId: string;
  let typoId: string;
  let correctionId: string;
  let jobReadingId: string;
  let jobNumber: string;

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

    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN", displayName: "Émilienne" });
    dlaOnly = await seedActor(ctx.db, {
      workspaceId,
      role: "DRIVER",
      branchIds: [seeded.branch.id],
    });
    ydeOnly = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [yaounde.id] });
    const other = await seedWorkspace(ctx.db);
    outsider = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });

    assetId = await seedAsset(ctx.app, admin.token, { assetCode: "RD-01" });
    for (const [day, value] of [
      ["01", 100_000],
      ["02", 100_400],
      ["03", 100_900],
    ] as const) {
      await api.ok(admin.token, "record-meter-reading", {
        readingId: randomUUID(),
        assetId,
        readingType: "ODOMETER",
        value,
        observedAt: `2026-08-${day}T08:00:00Z`,
      });
    }
    typoId = randomUUID();
    await api.ok(admin.token, "record-meter-reading", {
      readingId: typoId,
      assetId,
      readingType: "ODOMETER",
      value: 190_000,
      observedAt: "2026-08-04T08:00:00Z",
    });
    correctionId = randomUUID();
    await api.ok(admin.token, "record-meter-reading", {
      readingId: correctionId,
      assetId,
      readingType: "ODOMETER",
      value: 101_300,
      observedAt: "2026-08-04T09:00:00Z",
      supersedesReadingId: typoId,
      supersedeReason: "Chiffre en trop",
    });
    await api.ok(admin.token, "record-meter-reading", {
      readingId: randomUUID(),
      assetId,
      readingType: "HOURS",
      value: 5_000,
      observedAt: "2026-08-05T08:00:00Z",
    });

    // A Yaoundé job driven by this Douala truck: its reading belongs to the
    // job's branch, so a Douala-only reader must not see it (#58).
    const activityId = randomUUID();
    await api.ok(admin.token, "create-activity", {
      activityId,
      branchCode: "YDE",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: assetId,
      startedAt: "2026-08-06T06:00:00Z",
    });
    jobReadingId = randomUUID();
    await api.ok(admin.token, "record-meter-reading", {
      readingId: jobReadingId,
      assetId,
      activityId,
      readingType: "ODOMETER",
      value: 101_800,
      observedAt: "2026-08-06T07:00:00Z",
      source: "ACTIVITY_START",
    });
    const activity = await api.get(admin.token, `/v1/activities/${activityId}`);
    jobNumber = (activity.body as { activityNumber: string }).activityNumber;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function page(token: string, query = "") {
    const response = await api.get(token, `/v1/assets/${assetId}/readings${query}`);
    expect(response.status).toBe(200);
    return assetReadingsResponse.parse(response.body);
  }

  it("walks every reading newest first across pages, without gaps or repeats", async () => {
    const seen: AssetReadingItem[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const body = await page(admin.token, query);
      seen.push(...body.items);
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen.map((item) => item.id)).size).toBe(7);
    const times = seen.map((item) => item.observedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("lists a superseded reading, flagged with its correction and reason", async () => {
    const body = await page(admin.token);
    expect(body.items.find((item) => item.id === typoId)).toMatchObject({
      value: 190_000,
      supersededById: correctionId,
      supersedeReason: "Chiffre en trop",
    });
    expect(body.items.find((item) => item.id === correctionId)).toMatchObject({
      supersededById: null,
      origin: "HUMAN_UI",
      recordedBy: { principalId: admin.principalId, displayName: "Émilienne", scope: "WORKSPACE" },
    });
  });

  it("carries the job number of a reading taken during a job", async () => {
    const body = await page(admin.token);
    expect(body.items.find((item) => item.id === jobReadingId)).toMatchObject({
      source: "ACTIVITY_START",
      activityNumber: jobNumber,
    });
  });

  it("filters by reading type", async () => {
    const body = await page(admin.token, "?readingType=HOURS");
    expect(body.items.map((item) => item.value)).toEqual([5_000]);
  });

  it("hides a reading taken during another branch's job from a branch-scoped reader", async () => {
    const body = await page(dlaOnly.token);
    expect(body.items).toHaveLength(6);
    expect(body.items.some((item) => item.id === jobReadingId)).toBe(false);
  });

  it("answers 404 outside the caller's branches or workspace", async () => {
    for (const actor of [ydeOnly, outsider]) {
      const response = await api.get(actor.token, `/v1/assets/${assetId}/readings`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    }
  });

  it("refuses a malformed cursor or reading type", async () => {
    for (const query of ["?cursor=garbage", "?readingType=FUEL"]) {
      const response = await api.get(admin.token, `/v1/assets/${assetId}/readings${query}`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
    }
  });

  it("answers MODULE_DISABLED when ACTIVITIES is off", async () => {
    const gated = await seedWorkspace(ctx.db);
    const gatedAdmin = await seedActor(ctx.db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
    const gatedAsset = await seedAsset(ctx.app, gatedAdmin.token);
    await setModule(ctx.db, gated.workspace.id, "ACTIVITIES", false);

    const response = await api.get(gatedAdmin.token, `/v1/assets/${gatedAsset}/readings`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: "MODULE_DISABLED", metadata: { module: "ACTIVITIES" } },
    });
  });
});
