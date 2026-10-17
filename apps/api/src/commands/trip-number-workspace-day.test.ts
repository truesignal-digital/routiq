import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, workspaces } from "../db/schema.js";
import { apiClient, seedActor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * A trip number's year is the workspace's year on the day the trip started,
 * not the date as typed in the timestamp (#555). New Year's night is where the
 * two disagree.
 */
describe("trip numbers take the workspace's day", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function zonedWorkspace(timezone: string) {
    const seeded = await seedWorkspace(ctx.db);
    await ctx.db
      .update(workspaces)
      .set({ timezone })
      .where(eq(workspaces.id, seeded.workspace.id));
    const admin = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN" });
    const vehicle = () =>
      seedAsset(ctx.app, admin.token, { assetCode: `TZ-${randomUUID().slice(0, 8)}` });

    async function numberOf(activityId: string): Promise<string> {
      const [row] = await ctx.db
        .select({ activityNumber: activities.activityNumber })
        .from(activities)
        .where(eq(activities.id, activityId));
      return row?.activityNumber ?? "";
    }

    async function openTrip(startedAt: string): Promise<string> {
      const activityId = randomUUID();
      await api.ok(admin.token, "create-activity", {
        activityId,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: await vehicle(),
        startedAt,
      });
      return numberOf(activityId);
    }

    async function sheetTrip(startedAt: string): Promise<string> {
      const activityId = randomUUID();
      await api.ok(admin.token, "record-haulage-job-sheet", {
        activityId,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        primarySegmentId: randomUUID(),
        primaryAssetId: await vehicle(),
        startedAt,
        endedAt: new Date(Date.parse(startedAt) + 6 * 3_600_000).toISOString(),
      });
      return numberOf(activityId);
    }

    return { openTrip, sheetTrip };
  }

  const CASES = [
    // 00:30 on New Year's Day in Douala (UTC+1) is 23:30 UTC the day before.
    { timezone: "Africa/Douala", startedAt: "2026-12-31T23:30:00Z", year: "2027" },
    // 00:30 on New Year's Day at UTC+14 is still 10:30 UTC on 31 December.
    { timezone: "Pacific/Kiritimati", startedAt: "2026-12-31T10:30:00Z", year: "2027" },
    // 23:30 on New Year's Eve at UTC-11 is already 10:30 UTC on 1 January.
    { timezone: "Pacific/Pago_Pago", startedAt: "2027-01-01T10:30:00Z", year: "2026" },
    // Typed with another zone's offset: the date written is not the workspace's.
    { timezone: "Pacific/Pago_Pago", startedAt: "2027-01-01T00:30:00+01:00", year: "2026" },
  ] as const;

  it.each(CASES)(
    "numbers a trip started at $startedAt in $timezone in $year",
    async ({ timezone, startedAt, year }) => {
      const ws = await zonedWorkspace(timezone);
      expect(await ws.openTrip(startedAt)).toBe(`DLA-${year}-00001`);
    },
  );

  it.each(CASES)(
    "numbers a sheet started at $startedAt in $timezone in $year",
    async ({ timezone, startedAt, year }) => {
      const ws = await zonedWorkspace(timezone);
      expect(await ws.sheetTrip(startedAt)).toBe(`DLA-${year}-00001`);
    },
  );
});
