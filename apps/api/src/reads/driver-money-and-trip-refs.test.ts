import { randomUUID } from "node:crypto";
import { activityDetail, assetReadingsResponse, vehicleHistoryResponse } from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, financialEntries, financialPostings } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * #593: a driver's money views list expenses only. Revenue is a trip's price,
 * which a driver does not see (owner rule 2026-10-08), even on an entry they
 * recorded before #570 stopped drivers recording revenue. The rule is the
 * money scope itself (`readableEntrySql`), so the entries list, an entry's
 * detail and history, the vehicle timeline and the trip page all follow it.
 *
 * #594: the vehicle's readings name a trip only when the reader may read it.
 */
describe("a driver's money and trip references (#593, #594)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let moussa: Actor;
  let paul: Actor;
  let truckId: string;
  const moussasTrip = randomUUID();
  const paulsTrip = randomUUID();
  const entry = { officeRevenue: randomUUID(), moussaExpense: randomUUID(), moussaRevenue: "" };
  const reading = { moussa: randomUUID(), paul: randomUUID() };

  async function recordTrip(actor: Actor, activityId: string) {
    await api.ok(actor.token, "create-activity", {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: truckId,
      startedAt: "2026-10-06T06:00:00Z",
    });
  }

  /**
   * Revenue the driver recorded, as they could before #570: no command writes
   * one now and postings are append-only, so it is a copy of the office's
   * revenue under one of the driver's commands.
   */
  async function plantDriverRevenue(revenueEntryId: string, createdByCommandId: string): Promise<string> {
    const [original] = await ctx.db.select().from(financialEntries).where(eq(financialEntries.id, revenueEntryId));
    if (!original) throw new Error("no revenue entry to copy");
    const postings = await ctx.db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, revenueEntryId));
    const entryId = randomUUID();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(financialEntries).values({
        ...original,
        id: entryId,
        entryNumber: `${original.entryNumber}-${entryId.slice(0, 4)}`,
        createdByCommandId,
      });
      await tx.insert(financialPostings).values(
        postings.map((posting) => ({ ...posting, id: randomUUID(), financialEntryId: entryId, createdByCommandId })),
      );
    });
    return entryId;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    moussa = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    paul = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    truckId = await seedAsset(ctx.app, admin.token, { assetCode: "MONEY-TRUCK" });

    await recordTrip(moussa, moussasTrip);
    await recordTrip(paul, paulsTrip);

    await api.ok(admin.token, "record-revenue", {
      entryId: entry.officeRevenue,
      branchCode: "DLA",
      categoryCode: "FREIGHT_REVENUE",
      economicDate: "2026-10-06",
      amountMinor: 300_000,
      paymentMethod: "BANK",
      postings: [{ assetId: truckId, activityId: moussasTrip, amountMinor: 300_000 }],
    });
    await api.ok(moussa.token, "record-expense", {
      entryId: entry.moussaExpense,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-10-06",
      amountMinor: 40_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truckId, activityId: moussasTrip, amountMinor: 40_000 }],
    });
    const [trip] = await ctx.db
      .select({ createdByCommandId: activities.createdByCommandId })
      .from(activities)
      .where(eq(activities.id, moussasTrip));
    entry.moussaRevenue = await plantDriverRevenue(entry.officeRevenue, trip!.createdByCommandId);

    for (const [actor, readingId, activityId, value] of [
      [moussa, reading.moussa, moussasTrip, 120_000],
      [paul, reading.paul, paulsTrip, 120_300],
    ] as const) {
      await api.ok(actor.token, "record-meter-reading", {
        readingId,
        assetId: truckId,
        readingType: "ODOMETER",
        value,
        observedAt: `2026-10-06T0${value === 120_000 ? 8 : 9}:00:00Z`,
        activityId,
      });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  const entryIds = async (actor: Actor) => {
    const response = await api.get(actor.token, "/v1/finance/entries?limit=100");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as { entries: Array<{ id: string; direction: string }> }).entries;
  };

  it("lists a driver's own expenses, never revenue, even revenue they recorded", async () => {
    const forDriver = await entryIds(moussa);
    expect(forDriver.map((row) => row.id)).toEqual([entry.moussaExpense]);
    expect((await entryIds(admin)).map((row) => row.id).sort()).toEqual(
      [entry.officeRevenue, entry.moussaExpense, entry.moussaRevenue].sort(),
    );
    // A direction filter cannot widen it.
    const revenue = await api.get(moussa.token, "/v1/finance/entries?limit=100&direction=REVENUE");
    expect(revenue.status).toBe(200);
    expect((revenue.body as { entries: unknown[] }).entries).toEqual([]);
  });

  it("answers a revenue entry's detail and history like one that does not exist", async () => {
    for (const path of [`/v1/finance/entries/${entry.moussaRevenue}`, `/v1/history/financial_entry/${entry.moussaRevenue}`]) {
      const response = await api.get(moussa.token, path);
      expect(response.status, path).toBe(404);
      expect((await api.get(admin.token, path)).status, path).toBe(200);
    }
    expect((await api.get(moussa.token, `/v1/finance/entries/${entry.moussaExpense}`)).status).toBe(200);
  });

  it("keeps revenue out of the vehicle timeline for a driver", async () => {
    const money = async (actor: Actor) => {
      const response = await api.get(actor.token, `/v1/assets/${truckId}/history?limit=100&kind=MONEY`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return [
        ...new Set(
          vehicleHistoryResponse
            .parse(response.body)
            .items.filter((item) => item.subject.entityType === "financial_entry")
            .map((item) => item.subject.id),
        ),
      ].sort();
    };
    expect(await money(moussa)).toEqual([entry.moussaExpense]);
    // The planted copy has no audit event, so the timeline has nothing of it to show.
    expect(await money(admin)).toEqual([entry.officeRevenue, entry.moussaExpense].sort());
  });

  it("shows the driver's trip page money as expenses only", async () => {
    const response = await api.get(moussa.token, `/v1/activities/${moussasTrip}`);
    expect(response.status).toBe(200);
    const lines = activityDetail.parse(response.body).financialEntries ?? [];
    expect(lines.map((line) => [line.entryId, line.direction])).toEqual([[entry.moussaExpense, "EXPENSE"]]);
  });

  it("names a reading's trip only when the reader may read that trip", async () => {
    const refs = async (actor: Actor) => {
      const response = await api.get(actor.token, `/v1/assets/${truckId}/readings?limit=100`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return Object.fromEntries(
        assetReadingsResponse
          .parse(response.body)
          .items.map((item) => [item.id, { activityId: item.activityId, numbered: item.activityNumber !== null }]),
      );
    };
    const forMoussa = await refs(moussa);
    expect(forMoussa[reading.moussa]).toEqual({ activityId: moussasTrip, numbered: true });
    // Paul's reading stays listed (the vehicle's meter), without his trip.
    expect(forMoussa[reading.paul]).toEqual({ activityId: null, numbered: false });

    const forAdmin = await refs(admin);
    expect(forAdmin[reading.paul]).toEqual({ activityId: paulsTrip, numbered: true });
    expect(forAdmin[reading.moussa]).toEqual({ activityId: moussasTrip, numbered: true });
  });
});
