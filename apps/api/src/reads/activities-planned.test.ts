import { randomUUID } from "node:crypto";
import {
  activityDetail,
  activityListResponse,
  activitySummary,
  assetDetail,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * ADR-0012 §7 on the trip reads that predate Scheduling (#336): they keep
 * their meaning, so a client built before it never meets a trip with no
 * start; and the trip's price reaches only the roles that may read it, in
 * the read itself (#583).
 */
describe("trip reads with planned trips (#336, #583)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let director: Actor;
  let admin: Actor;
  let finance: Actor;
  let technician: Actor;
  let cashier: Actor;
  let driver: Actor;
  let truck: string;
  let plannedId: string;
  let cancelledId: string;
  let startedId: string;
  let sheetId: string;

  async function list(actor: Actor, query = ""): Promise<string[]> {
    const response = await api.get(actor.token, `/v1/activities?limit=100${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return activityListResponse.parse(response.body).items.map((item) => item.id);
  }

  async function detail(actor: Actor, id: string) {
    const response = await api.get(actor.token, `/v1/activities/${id}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return { parsed: activityDetail.parse(response.body), raw: response.body as Record<string, unknown> };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    technician = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER", branchIds: [seeded.branch.id] });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    await api.ok(director.token, "enable-module", { moduleCode: "SCHEDULING" });
    truck = await seedAsset(ctx.app, admin.token, { assetCode: "PLN-READS" });

    const planTrip = async (extra: Record<string, unknown> = {}) => {
      const activityId = randomUUID();
      await api.ok(admin.token, "plan-trip", {
        activityId,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        plannedStartAt: "2026-11-05T07:00:00+01:00",
        plannedAssetId: truck,
        customerName: "Cimencam",
        agreedPriceMinor: 900_000,
        amountToCollectMinor: 300_000,
        origin: { kind: "text", text: "Douala" },
        destination: { kind: "text", text: "Yaoundé" },
        ...extra,
      });
      return activityId;
    };
    plannedId = await planTrip();
    cancelledId = await planTrip();
    await api.ok(
      admin.token,
      "cancel-planned-trip",
      { activityId: cancelledId, reason: "OTHER", note: "Client parti ailleurs" },
      { expectedVersion: 1 },
    );
    startedId = await planTrip();
    await api.ok(admin.token, "start-planned-trip", {
      activityId: startedId,
      primarySegmentId: randomUUID(),
      primaryAssetId: truck,
      startedAt: "2026-10-06T07:20:00+01:00",
    });

    // A trip sheet the driver filed with its revenue and fuel, as drivers
    // could before #570 stopped them recording revenue.
    sheetId = randomUUID();
    await api.ok(driver.token, "record-haulage-job-sheet", {
      activityId: sheetId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId: truck,
      startedAt: "2026-10-01T06:00:00Z",
      endedAt: "2026-10-01T18:00:00Z",
      entries: [
        {
          entryId: randomUUID(),
          direction: "REVENUE",
          categoryCode: "FREIGHT_REVENUE",
          amountMinor: 300_000,
          economicDate: "2026-10-01",
        },
        {
          entryId: randomUUID(),
          direction: "EXPENSE",
          categoryCode: "FUEL",
          amountMinor: 40_000,
          economicDate: "2026-10-01",
        },
      ],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("lists only started trips unless PLANNED or CANCELLED is asked for by name", async () => {
    const unasked = await list(admin);
    expect(unasked).toContain(startedId);
    expect(unasked).not.toContain(plannedId);
    expect(unasked).not.toContain(cancelledId);
    expect(await list(admin, "&status=PLANNED")).toEqual([plannedId]);
    expect(await list(admin, "&status=CANCELLED")).toEqual([cancelledId]);
  });

  it("keeps planned trips out of the Trips tiles and the vehicle's recent trips", async () => {
    const summary = activitySummary.parse((await api.get(admin.token, "/v1/activities/summary")).body);
    expect(summary.open).toBe(2);
    const vehicle = assetDetail.parse((await api.get(admin.token, `/v1/assets/${truck}`)).body);
    expect(vehicle.recentActivities.map((row) => row.id).sort()).toEqual([startedId, sheetId].sort());
  });

  it("opens a planned trip with its plan, and a cancelled one with its reason", async () => {
    const { parsed: planned } = await detail(admin, plannedId);
    expect(planned).toMatchObject({
      status: "PLANNED",
      startedAt: null,
      plannedAsset: { id: truck, assetCode: "PLN-READS" },
      plannedDriver: null,
      plannedOriginName: "Douala",
      plannedDestinationName: "Yaoundé",
      cancellation: null,
      priceCurrency: "XAF",
    });
    const { parsed: cancelled } = await detail(admin, cancelledId);
    expect(cancelled.cancellation).toMatchObject({ reason: "OTHER", note: "Client parti ailleurs" });
  });

  it("serves the trip's price to the ledger readers and omits the keys for everyone else", async () => {
    for (const actor of [director, admin, finance]) {
      const { parsed } = await detail(actor, plannedId);
      expect(parsed.agreedPriceMinor).toBe(900_000);
      expect(parsed.amountToCollectMinor).toBe(300_000);
    }
    for (const actor of [technician, cashier, driver]) {
      const { raw } = await detail(actor, plannedId);
      expect(Object.keys(raw)).not.toContain("agreedPriceMinor");
      expect(Object.keys(raw)).not.toContain("amountToCollectMinor");
    }
  });

  it("withholds the trip's revenue lines from the driver, keeping their expenses (#583)", async () => {
    const { parsed: forDriver } = await detail(driver, sheetId);
    expect(forDriver.financialEntries?.map((entry) => entry.direction)).toEqual(["EXPENSE"]);
    const { parsed: forFinance } = await detail(finance, sheetId);
    expect(forFinance.financialEntries?.map((entry) => entry.direction).sort()).toEqual([
      "EXPENSE",
      "REVENUE",
    ]);
  });
});
