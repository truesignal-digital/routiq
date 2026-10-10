import { randomUUID } from "node:crypto";
import {
  ACTIVITY_OVERVIEW_WEEKS,
  activityListResponse,
  activitySummary,
  assetListResponse,
  assetOverview,
  maintenanceSummary,
  workOrderListResponse,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, approvalRules, branches, workOrders } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";
import { addDays, currentBusinessDate } from "./business-date.js";

const DAY = 86_400_000;

/**
 * The Trucks, Trips and Maintenance Overview tabs (#665). Every tile is
 * counted by the server inside the caller's branch scope, and a tile that
 * opens a list counts exactly what that list's filter returns.
 *
 * The fleet (DLA unless noted; all commissioned but VH007):
 * - VH001: two OPEN trips, A (now, 68 km) and H (3 days ago, no legs).
 * - VH002: grounded first; trip B (now, CLOSED, no legs, no fuel).
 * - VH003 (YDE): grounded second; trip D (now, CLOSED, 40 km, fuel waiting).
 * - VH004: never on a trip, so idle.
 * - VH005: trip C (9 days ago, CLOSED, 500 km, fuel posted), idle since.
 * - VH006: trip E (20 days ago, CLOSED, 10 km, fuel posted then reversed).
 * - VH007: registered, never commissioned.
 * - VH008 (YDE): trip I (100 days ago, before the chart, CLOSED, nothing).
 */
describe("module overviews", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let yaoundeId: string;
  let director: Actor;
  let approver: Actor;
  let cashier: Actor;
  let technician: Actor;
  let driver: Actor;
  let doualaOnly: Actor;
  const asset: Record<string, string> = {};
  const trip: Record<string, string> = {};

  /** Approval rules that send amounts of 100 000 and more to a DIRECTOR, for `run` only. */
  async function withThresholds<T>(commandTypes: string[], run: () => Promise<T>): Promise<T> {
    const inserted = await ctx.db
      .insert(approvalRules)
      .values(
        commandTypes.map((commandType) => ({
          workspaceId,
          commandType,
          categoryCode: null,
          branchId: null,
          amountMinMinor: 100_000n,
          amountMaxMinor: null,
          requiredRole: "DIRECTOR" as const,
          createdByCommandId: null,
        })),
      )
      .returning({ id: approvalRules.id });
    try {
      return await run();
    } finally {
      await ctx.db.delete(approvalRules).where(
        inArray(
          approvalRules.id,
          inserted.map((row) => row.id),
        ),
      );
    }
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
    yaoundeId = yaounde.id;

    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    approver = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER" });
    technician = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    doualaOnly = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [seeded.branch.id] });

    for (const [code, branchCode] of [
      ["VH001", "DLA"],
      ["VH002", "DLA"],
      ["VH003", "YDE"],
      ["VH004", "DLA"],
      ["VH005", "DLA"],
      ["VH006", "DLA"],
      ["VH007", "DLA"],
      ["VH008", "YDE"],
    ] as const) {
      asset[code] = await seedAsset(ctx.app, director.token, { assetCode: code, branchCode });
      if (code !== "VH007") {
        await api.ok(director.token, "commission-asset", { assetId: asset[code] }, { expectedVersion: 1 });
      }
    }

    const today = currentBusinessDate(new Date(), "Africa/Douala");
    const now = Date.now();
    const startTrip = async (code: string, branchCode: string, startedAt: number, legsKm: number[] = []) => {
      const activityId = randomUUID();
      const segmentId = randomUUID();
      await api.ok(director.token, "create-activity", {
        activityId,
        branchCode,
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: segmentId,
        primaryAssetId: asset[code],
        startedAt: new Date(startedAt).toISOString(),
      });
      for (const [index, km] of legsKm.entries()) {
        await api.ok(director.token, "record-movement-leg", {
          legId: randomUUID(),
          activityId,
          legNo: index + 1,
          segmentId,
          origin: { kind: "text", text: `Stop ${index}` },
          destination: { kind: "text", text: `Stop ${index + 1}` },
          distanceKm: km,
        });
      }
      return activityId;
    };
    const fuel = async (actor: Actor, activityId: string, code: string, branchCode: string, amountMinor: number) => {
      const entryId = randomUUID();
      const result = await api.ok(actor.token, "record-expense", {
        entryId,
        branchCode,
        categoryCode: "FUEL",
        economicDate: today,
        amountMinor,
        paymentMethod: "CASH",
        postings: [{ assetId: asset[code], activityId, amountMinor }],
      });
      return { entryId, rowVersion: result.rowVersion, status: result.recordStatus };
    };
    // Closing is the close command's job; these reads only read the columns.
    const close = async (activityId: string, endedAt: number) => {
      await ctx.db
        .update(activities)
        .set({ status: "CLOSED", completeness: "COMPLETE", endedAt: new Date(endedAt), closedAt: new Date(endedAt) })
        .where(and(eq(activities.workspaceId, workspaceId), eq(activities.id, activityId)));
    };

    trip.A = await startTrip("VH001", "DLA", now - 1_000, [68]);
    trip.H = await startTrip("VH001", "DLA", now - 3 * DAY);
    trip.B = await startTrip("VH002", "DLA", now - 2_000);
    trip.D = await startTrip("VH003", "YDE", now - 3_000, [40]);
    trip.C = await startTrip("VH005", "DLA", now - 9 * DAY, [500]);
    trip.E = await startTrip("VH006", "DLA", now - 20 * DAY, [10]);
    trip.I = await startTrip("VH008", "YDE", now - 100 * DAY);

    const waiting = await withThresholds(["record-expense"], () => fuel(cashier, trip.D!, "VH003", "YDE", 150_000));
    expect(waiting.status).toBe("SUBMITTED");
    expect((await fuel(director, trip.C!, "VH005", "DLA", 40_000)).status).toBe("POSTED");
    const reversed = await fuel(director, trip.E!, "VH006", "DLA", 30_000);
    expect(reversed.status).toBe("POSTED");
    await api.ok(
      approver.token,
      "reverse-entry",
      { reversalEntryId: randomUUID(), originalEntryId: reversed.entryId, reason: "Mauvais voyage" },
      { expectedVersion: reversed.rowVersion },
    );

    await close(trip.B, now - 1_000);
    await close(trip.D, now - 1_000);
    await close(trip.C, now - 8 * DAY);
    await close(trip.E, now - 19 * DAY);
    await close(trip.I, now - 99 * DAY);

    // Maintenance: VH002 then VH003 grounded by a safety-critical issue.
    const report = async (code: string) => {
      const issueId = randomUUID();
      await api.ok(director.token, "report-issue", {
        issueId,
        assetId: asset[code],
        description: "Freins",
        safetyCritical: true,
      });
      return issueId;
    };
    const vh002Issue = await report("VH002");
    await report("VH003");

    const createOrder = async (code: string, expectedCostMinor = 0, issueId?: string) => {
      const workOrderId = randomUUID();
      const created = await api.ok(technician.token, "create-work-order", {
        workOrderId,
        assetId: asset[code],
        ...(issueId === undefined ? {} : { issueId }),
        description: "Réparer",
        expectedCostMinor,
      });
      return { workOrderId, rowVersion: created.rowVersion, status: created.recordStatus };
    };
    const repairCost = async (code: string, branchCode: string, workOrderId: string, amountMinor: number) => {
      const entryId = randomUUID();
      const result = await api.ok(director.token, "record-expense", {
        entryId,
        branchCode,
        categoryCode: "REPAIRS",
        economicDate: today,
        amountMinor,
        paymentMethod: "BANK",
        postings: [{ assetId: asset[code], workOrderId, amountMinor }],
      });
      return { entryId, rowVersion: result.rowVersion };
    };
    const complete = async (order: { workOrderId: string; rowVersion: number }, actualCostMinor: number) =>
      api.ok(
        technician.token,
        "complete-work-order",
        { workOrderId: order.workOrderId, actualCostMinor, summary: "Réparé" },
        { expectedVersion: order.rowVersion },
      );

    // W1 APPROVED, W2 SUBMITTED, W3 COMPLETION_SUBMITTED: the open ones.
    expect((await createOrder("VH002", 0, vh002Issue)).status).toBe("APPROVED");
    await withThresholds(["create-work-order", "complete-work-order"], async () => {
      expect((await createOrder("VH001", 150_000)).status).toBe("SUBMITTED");
      const w3 = await createOrder("VH005");
      expect((await complete(w3, 150_000)).recordStatus).toBe("COMPLETION_SUBMITTED");
    });
    // W4 (YDE) and W5 completed in XAF; W5 carries a cancelled line too.
    const w4 = await createOrder("VH003");
    await repairCost("VH003", "YDE", w4.workOrderId, 70_000);
    expect((await complete(w4, 70_000)).recordStatus).toBe("COMPLETED");
    const w5 = await createOrder("VH004");
    await repairCost("VH004", "DLA", w5.workOrderId, 30_000);
    const cancelled = await repairCost("VH004", "DLA", w5.workOrderId, 5_000);
    await api.ok(
      approver.token,
      "reverse-entry",
      { reversalEntryId: randomUUID(), originalEntryId: cancelled.entryId, reason: "Doublon" },
      { expectedVersion: cancelled.rowVersion },
    );
    expect((await complete(w5, 30_000)).recordStatus).toBe("COMPLETED");
    // W6 completed in another currency: counted as a repair, never summed.
    const w6 = await createOrder("VH006");
    await repairCost("VH006", "DLA", w6.workOrderId, 99_000);
    await complete(w6, 99_000);
    await ctx.db
      .update(workOrders)
      .set({ currency: "EUR" })
      .where(and(eq(workOrders.workspaceId, workspaceId), eq(workOrders.id, w6.workOrderId)));
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function get<T>(actor: Actor, url: string, schema: { parse(value: unknown): T }): Promise<T> {
    const response = await api.get(actor.token, url);
    expect(response.status, `${url} ${JSON.stringify(response.body)}`).toBe(200);
    return schema.parse(response.body);
  }

  async function withModuleOff(
    code: "FINANCE" | "MAINTENANCE" | "ACTIVITIES",
    run: () => Promise<void>,
  ): Promise<void> {
    await setModule(ctx.db, workspaceId, code, false);
    try {
      await run();
    } finally {
      await setModule(ctx.db, workspaceId, code, true);
    }
  }

  describe("GET /v1/assets/overview", () => {
    const overview = (actor: Actor, query = "") => get(actor, `/v1/assets/overview${query}`, assetOverview);
    const listed = async (actor: Actor, query: string) =>
      (await get(actor, `/v1/assets?limit=100&${query}`, assetListResponse)).items.map((item) => item.assetCode).sort();

    it("counts the fleet that can work", async () => {
      const body = await overview(director);
      expect(body).toMatchObject({ total: 8, canDrive: 5 });
      expect(body.grounded).toEqual({
        count: 2,
        first: { assetId: asset.VH002, assetCode: "VH002", since: expect.any(String) },
      });
      expect(body.idle).toEqual({
        count: 4,
        days: 5,
        first: { assetId: asset.VH004, assetCode: "VH004", lastTripAt: null },
      });
    });

    it("counts exactly what each availability filter lists", async () => {
      for (const actor of [director, doualaOnly]) {
        const body = await overview(actor);
        expect(await listed(actor, "availability=CAN_DRIVE")).toHaveLength(body.canDrive);
        expect(await listed(actor, "availability=GROUNDED")).toHaveLength(body.grounded!.count);
        expect(await listed(actor, "availability=IDLE")).toHaveLength(body.idle!.count);
        expect(await listed(actor, "")).toHaveLength(body.total);
      }
      expect(await listed(director, "availability=CAN_DRIVE")).toEqual(["VH001", "VH004", "VH005", "VH006", "VH008"]);
      expect(await listed(director, "availability=GROUNDED")).toEqual(["VH002", "VH003"]);
      expect(await listed(director, "availability=IDLE")).toEqual(["VH004", "VH005", "VH006", "VH008"]);
    });

    it("stays inside the caller's branch scope, and narrows within it", async () => {
      const dla = await overview(doualaOnly);
      expect(dla).toMatchObject({ total: 6, canDrive: 4, grounded: { count: 1 }, idle: { count: 3 } });
      expect(dla.grounded?.first?.assetCode).toBe("VH002");

      const yde = await overview(director, `?branchId=${yaoundeId}`);
      expect(yde).toMatchObject({ total: 2, canDrive: 1, grounded: { count: 1 }, idle: { count: 1 } });
      expect(yde.grounded?.first?.assetCode).toBe("VH003");
      expect(yde.idle?.first).toMatchObject({ assetCode: "VH008", lastTripAt: expect.any(String) });
      expect(await listed(director, `branchId=${yaoundeId}&availability=IDLE`)).toEqual(["VH008"]);

      // A branch outside the scope narrows to nothing, never widens.
      expect(await overview(doualaOnly, `?branchId=${yaoundeId}`)).toMatchObject({
        total: 0,
        canDrive: 0,
        grounded: { count: 0, first: null },
        idle: { count: 0, first: null },
      });
    });

    it("withholds grounded while Maintenance is off, and stops subtracting it", async () => {
      await withModuleOff("MAINTENANCE", async () => {
        const body = await overview(director);
        expect(body.grounded).toBeNull();
        // Grounding is a Maintenance fact: every IN_SERVICE vehicle can drive.
        expect(body.canDrive).toBe(7);
        expect(await listed(director, "availability=GROUNDED")).toEqual([]);
        expect(await listed(director, "availability=CAN_DRIVE")).toHaveLength(7);
      });
    });

    it("withholds idle while Trips is off", async () => {
      await withModuleOff("ACTIVITIES", async () => {
        const body = await overview(director);
        expect(body.idle).toBeNull();
        expect(body.grounded?.count).toBe(2);
        expect(await listed(director, "availability=IDLE")).toEqual([]);
      });
    });

    it("refuses a malformed branch and an unknown availability", async () => {
      expect((await api.get(director.token, "/v1/assets/overview?branchId=nope")).status).toBe(400);
      expect((await api.get(director.token, "/v1/assets?availability=PARKED")).status).toBe(400);
    });
  });

  describe("GET /v1/activities/summary", () => {
    const summary = (actor: Actor, query = "") => get(actor, `/v1/activities/summary${query}`, activitySummary);
    const listed = async (actor: Actor, query: string) =>
      (await get(actor, `/v1/activities?limit=100&${query}`, activityListResponse)).items.map((item) => item.id);

    it("counts this week's closed trips, the oldest open one and what closed trips miss", async () => {
      const body = await summary(director);
      expect(body).toMatchObject({
        open: 2,
        weekClosed: 2,
        closedMissing: { fuel: 3, km: 2 },
        oldestOpen: { id: trip.H, assetCode: "VH001", startedAt: expect.any(String) },
      });
      expect(new Set(await listed(director, "missing=km"))).toEqual(new Set([trip.B, trip.I]));
      // A waiting fuel line counts; a reversed one does not.
      expect(new Set(await listed(director, "missing=fuel"))).toEqual(new Set([trip.B, trip.E, trip.I]));
    });

    it("counts exactly what each tile's filter lists", async () => {
      for (const [actor, query] of [
        [director, ""],
        [doualaOnly, ""],
        [director, `branchId=${yaoundeId}`],
      ] as const) {
        const body = await summary(actor, query === "" ? "" : `?${query}`);
        const scoped = (filter: string) => listed(actor, [query, filter].filter(Boolean).join("&"));
        const { from, to } = body.week;
        expect(await scoped(`status=CLOSED&from=${from}&to=${to}`)).toHaveLength(body.weekClosed);
        expect(await scoped(`from=${from}&to=${to}`)).toHaveLength(body.thisWeek);
        expect(await scoped("missing=km")).toHaveLength(body.closedMissing.km);
        expect(await scoped("missing=fuel")).toHaveLength(body.closedMissing.fuel!);
        const open = await scoped("status=OPEN&sort=startedAt:asc");
        expect(open).toHaveLength(body.open);
        expect(body.oldestOpen?.id ?? null).toBe(open[0] ?? null);
      }
    });

    it("charts twelve business weeks, the current one last, each equal to its list", async () => {
      const body = await summary(director);
      expect(body.weeks).toHaveLength(ACTIVITY_OVERVIEW_WEEKS);
      expect(body.weeks.at(-1)).toMatchObject(body.week);
      for (const [index, week] of body.weeks.entries()) {
        if (index > 0) expect(week.from).toBe(addDays(body.weeks[index - 1]!.from, 7));
        expect(week.to).toBe(addDays(week.from, 6));
        expect(await listed(director, `from=${week.from}&to=${week.to}`), week.from).toHaveLength(week.started);
        expect(await listed(director, `status=CLOSED&from=${week.from}&to=${week.to}`), week.from).toHaveLength(
          week.closed,
        );
      }
      // A, H, B, D, C and E; I started before the chart.
      expect(body.weeks.reduce((sum, week) => sum + week.started, 0)).toBe(6);
      expect(body.weeks.reduce((sum, week) => sum + week.closed, 0)).toBe(4);
    });

    it("stays inside the caller's branch scope, and narrows within it", async () => {
      expect(await summary(doualaOnly)).toMatchObject({
        open: 2,
        weekClosed: 1,
        closedMissing: { fuel: 2, km: 1 },
        oldestOpen: { id: trip.H },
      });
      expect(await summary(director, `?branchId=${yaoundeId}`)).toMatchObject({
        open: 0,
        weekClosed: 1,
        oldestOpen: null,
        closedMissing: { fuel: 1, km: 1 },
      });
      const outside = await summary(doualaOnly, `?branchId=${yaoundeId}`);
      expect(outside).toMatchObject({ open: 0, weekClosed: 0, oldestOpen: null, closedMissing: { fuel: 0, km: 0 } });
      expect(outside.weeks.every((week) => week.started === 0 && week.closed === 0)).toBe(true);
      expect(await listed(doualaOnly, `branchId=${yaoundeId}&missing=km`)).toEqual([]);
    });

    it("lists closed trips only for missing, so another status lists nothing", async () => {
      expect(await listed(director, "missing=km&status=OPEN")).toEqual([]);
      expect(new Set(await listed(director, "missing=km&status=CLOSED"))).toEqual(new Set([trip.B, trip.I]));
      expect((await api.get(director.token, "/v1/activities?missing=tyres")).status).toBe(400);
    });

    it("withholds the fuel count while Money is off, and refuses its filter", async () => {
      await withModuleOff("FINANCE", async () => {
        const body = await summary(director);
        expect(body.closedMissing).toEqual({ fuel: null, km: 2 });
        const refused = await api.get(director.token, "/v1/activities?missing=fuel");
        expect(refused.status).toBe(400);
        expect(refused.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
        expect(await listed(director, "missing=km")).toHaveLength(2);
      });
    });
  });

  describe("GET /v1/maintenance/summary", () => {
    const summary = (actor: Actor, query = "") => get(actor, `/v1/maintenance/summary${query}`, maintenanceSummary);
    const listed = async (actor: Actor, query: string) =>
      (await get(actor, `/v1/work-orders?limit=100&${query}`, workOrderListResponse)).items;

    it("counts the work orders by where they wait, and the repair cost", async () => {
      const body = await summary(director);
      expect(body).toMatchObject({
        grounded: 2,
        firstGrounded: { assetId: asset.VH002, assetCode: "VH002", since: expect.any(String) },
        approvedWorkOrders: 1,
        openWorkOrders: 3,
        waitingApproval: 1,
        waitingCompletion: 1,
        repairsCounted: 3,
        // W4 and W5 in XAF; W5's cancelled line nets out; W6 is in EUR.
        repairCost: { amountMinor: 100_000, currency: "XAF", workOrders: 2 },
      });
    });

    it("counts exactly what each work-order filter lists", async () => {
      for (const [actor, query] of [
        [director, ""],
        [doualaOnly, ""],
        [director, `branchId=${yaoundeId}`],
      ] as const) {
        const body = await summary(actor, query === "" ? "" : `?${query}`);
        const scoped = (filter: string) => listed(actor, [query, filter].filter(Boolean).join("&"));
        expect(await scoped("open=true")).toHaveLength(body.openWorkOrders);
        expect(await scoped("status=SUBMITTED")).toHaveLength(body.waitingApproval);
        expect(await scoped("status=COMPLETION_SUBMITTED")).toHaveLength(body.waitingCompletion);
        expect(await scoped("status=APPROVED")).toHaveLength(body.approvedWorkOrders);
      }
    });

    it("filters the open orders, and combines with a status", async () => {
      const open = await listed(director, "open=true");
      expect(open.map((order) => order.status).sort()).toEqual(["APPROVED", "COMPLETION_SUBMITTED", "SUBMITTED"]);
      const rest = await listed(director, "open=false");
      expect(rest.map((order) => order.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED"]);
      expect(await listed(director, "open=true&status=SUBMITTED")).toHaveLength(1);
      expect(await listed(director, "open=true&status=COMPLETED")).toEqual([]);
      expect(await listed(director, "open=false&status=APPROVED")).toEqual([]);
      expect((await api.get(director.token, "/v1/work-orders?open=yes")).status).toBe(400);
    });

    it("stays inside the caller's branch scope, and narrows within it", async () => {
      expect(await summary(doualaOnly)).toMatchObject({
        grounded: 1,
        firstGrounded: { assetCode: "VH002" },
        openWorkOrders: 3,
        repairsCounted: 2,
        repairCost: { amountMinor: 30_000, currency: "XAF", workOrders: 1 },
      });
      expect(await summary(director, `?branchId=${yaoundeId}`)).toMatchObject({
        grounded: 1,
        firstGrounded: { assetCode: "VH003" },
        openWorkOrders: 0,
        waitingApproval: 0,
        waitingCompletion: 0,
        repairsCounted: 1,
        repairCost: { amountMinor: 70_000, currency: "XAF", workOrders: 1 },
      });
      expect(await summary(doualaOnly, `?branchId=${yaoundeId}`)).toMatchObject({
        grounded: 0,
        firstGrounded: null,
        openWorkOrders: 0,
        repairCost: { amountMinor: 0, workOrders: 0 },
      });
    });

    it("shows the repair cost to the workshop, never to a driver", async () => {
      expect((await summary(technician)).repairCost).toEqual({
        amountMinor: 100_000,
        currency: "XAF",
        workOrders: 2,
      });
      const forDriver = await summary(driver);
      expect(forDriver.repairCost).toBeNull();
      expect(forDriver.openWorkOrders).toBe(3);
    });

    it("withholds the repair cost while Money is off", async () => {
      await withModuleOff("FINANCE", async () => {
        const body = await summary(director);
        expect(body.repairCost).toBeNull();
        expect(body.repairsCounted).toBe(3);
      });
    });
  });
});

