import { randomUUID } from "node:crypto";
import { financeOverviewResponse, type FinanceOverviewResponse, type Role } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedWorkspace } from "../test/seed.js";
import { shiftMonth } from "./asset-finance.js";
import { currentBusinessDate } from "./business-date.js";
import { overviewSeriesMonths, overviewWindows } from "./finance-overview.js";

describe("overview windows", () => {
  it("compares this month so far with the same days of last month", () => {
    expect(overviewWindows("2026-10-09", "THIS_MONTH")).toEqual({
      period: { from: "2026-10-01", to: "2026-10-09" },
      comparison: { from: "2026-09-01", to: "2026-09-09" },
    });
  });

  it("clamps the comparison to a shorter month, across a year", () => {
    expect(overviewWindows("2026-03-31", "THIS_MONTH").comparison).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(overviewWindows("2028-03-30", "THIS_MONTH").comparison).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(overviewWindows("2027-01-05", "THIS_MONTH").comparison).toEqual({ from: "2026-12-01", to: "2026-12-05" });
  });

  it("uses whole closed months against the months just before", () => {
    expect(overviewWindows("2026-10-09", "THREE_MONTHS")).toEqual({
      period: { from: "2026-07-01", to: "2026-09-30" },
      comparison: { from: "2026-04-01", to: "2026-06-30" },
    });
    expect(overviewWindows("2026-10-09", "TWELVE_MONTHS")).toEqual({
      period: { from: "2025-10-01", to: "2026-09-30" },
      comparison: { from: "2024-10-01", to: "2025-09-30" },
    });
  });

  it("charts the 12 closed months before this one", () => {
    expect(overviewSeriesMonths("2026-10-09")).toEqual([
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
      "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
  });
});

/**
 * #660: the money every Overview reads. One workspace with two branches, three
 * trucks with money and one without, company costs, revenue on no truck, a
 * cancelled expense, an expense still waiting, and trips closed with and
 * without km. Every expectation below is worked out by hand from those lines.
 */
describe("GET /v1/finance/overview", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let doualaId: string;
  let yaoundeId: string;
  const actors = {} as Record<Role, Actor>;
  const trucks = { t1: "", t2: "", t3: "", t4: "" };
  const today = currentBusinessDate(new Date(), "Africa/Douala");
  const month = today.slice(0, 7);
  const periodDay = `${month}-01`;
  const comparisonDay = `${shiftMonth(month, -1)}-01`;

  async function registerTruck(code: string, branchCode: string): Promise<string> {
    const assetId = randomUUID();
    await api.ok(actors.DIRECTOR.token, "register-asset", {
      assetId,
      assetCode: code,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode,
    });
    return assetId;
  }

  async function record(
    actor: Actor,
    direction: "REVENUE" | "EXPENSE",
    line: { branchCode: string; categoryCode: string; economicDate: string; postings: { assetId?: string; amountMinor: number }[] },
  ) {
    const entryId = randomUUID();
    const amountMinor = line.postings.reduce((sum, posting) => sum + posting.amountMinor, 0);
    const reply = await api.ok(actor.token, direction === "REVENUE" ? "record-revenue" : "record-expense", {
      entryId,
      ...line,
      amountMinor,
      paymentMethod: "CASH",
    });
    return { entryId, ...reply };
  }

  const expense = (branchCode: string, categoryCode: string, economicDate: string, postings: { assetId?: string; amountMinor: number }[]) =>
    record(actors.DIRECTOR, "EXPENSE", { branchCode, categoryCode, economicDate, postings });
  const revenue = (branchCode: string, economicDate: string, postings: { assetId?: string; amountMinor: number }[]) =>
    record(actors.DIRECTOR, "REVENUE", { branchCode, categoryCode: "FREIGHT_REVENUE", economicDate, postings });

  async function trip(assetId: string, legKm: (number | undefined)[], close: boolean) {
    const now = Date.now();
    await api.ok(actors.DIRECTOR.token, "record-haulage-job-sheet", {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId: assetId,
      startedAt: new Date(now - 2 * 3_600_000).toISOString(),
      endedAt: new Date(now - 3_600_000).toISOString(),
      legs: legKm.map((distanceKm, i) => ({
        legId: randomUUID(),
        legNo: i + 1,
        origin: { kind: "text", text: "Douala" },
        destination: { kind: "text", text: "Edéa" },
        ...(distanceKm === undefined ? {} : { distanceKm }),
      })),
      close,
    });
  }

  async function overview(actor: Actor, query = ""): Promise<FinanceOverviewResponse> {
    const reply = await api.get(actor.token, `/v1/finance/overview${query}`);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    return financeOverviewResponse.parse(reply.body);
  }

  /** Company profit from its parts, and the parts against the vehicle and branch rows. */
  function expectIdentity(body: FinanceOverviewResponse) {
    const company = body.companyProfit!.period;
    const vehicleSum = body.vehicles!.reduce((sum, vehicle) => sum + vehicle.profitMinor, 0);
    expect(company.vehicleProfitMinor).toBe(vehicleSum);
    expect(body.branches!.reduce((sum, branch) => sum + branch.vehicleProfitMinor, 0)).toBe(vehicleSum);
    expect(company.companyProfitMinor).toBe(
      vehicleSum + company.revenueWithoutVehicleMinor - company.companyCostsMinor,
    );
    expect(company.companyProfitMinor).toBe(body.period.profitMinor);
    expect(body.period.profitMinor).toBe(body.period.revenueMinor - body.period.expenseMinor);
    const comparison = body.companyProfit!.comparison;
    expect(comparison.companyProfitMinor).toBe(
      comparison.vehicleProfitMinor + comparison.revenueWithoutVehicleMinor - comparison.companyCostsMinor,
    );
    expect(comparison.companyProfitMinor).toBe(body.comparison.profitMinor);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    doualaId = seeded.branch.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    yaoundeId = yaounde!.id;
    actors.DIRECTOR = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    actors.FINANCE = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    for (const role of ["ADMIN", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      actors[role] = await seedActor(ctx.db, { workspaceId, role, branchIds: [doualaId] });
    }

    trucks.t1 = await registerTruck("T1", "DLA");
    trucks.t2 = await registerTruck("T2", "DLA");
    trucks.t3 = await registerTruck("T3", "YDE");
    trucks.t4 = await registerTruck("T4", "DLA");

    // This month (Direction's own entries post at any amount).
    await revenue("DLA", periodDay, [{ assetId: trucks.t1, amountMinor: 500_000 }]);
    await expense("DLA", "FUEL", periodDay, [{ assetId: trucks.t1, amountMinor: 200_000 }]);
    await expense("DLA", "REPAIRS", periodDay, [{ assetId: trucks.t2, amountMinor: 80_000 }]);
    await expense("DLA", "INSURANCE", periodDay, [{ amountMinor: 60_000 }]);
    await revenue("DLA", periodDay, [{ amountMinor: 40_000 }]);
    await revenue("YDE", periodDay, [{ assetId: trucks.t3, amountMinor: 300_000 }]);
    await expense("YDE", "FUEL", periodDay, [{ assetId: trucks.t3, amountMinor: 100_000 }]);
    await expense("YDE", "INSURANCE", periodDay, [{ amountMinor: 25_000 }]);
    // One fuel receipt split over two trucks.
    await expense("DLA", "FUEL", periodDay, [
      { assetId: trucks.t1, amountMinor: 10_000 },
      { assetId: trucks.t2, amountMinor: 20_000 },
    ]);
    // Cancelled: the original and its posted cancellation net to zero.
    const cancelled = await expense("DLA", "FUEL", periodDay, [{ assetId: trucks.t2, amountMinor: 15_000 }]);
    await api.ok(
      actors.DIRECTOR.token,
      "reverse-entry",
      { reversalEntryId: randomUUID(), originalEntryId: cancelled.entryId, reasonCode: "ENTERED_TWICE" },
      { expectedVersion: cancelled.rowVersion },
      2,
    );
    // Finance's own expense above its band waits for a decision: never counted.
    const waiting = await record(actors.FINANCE, "EXPENSE", {
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: periodDay,
      postings: [{ assetId: trucks.t1, amountMinor: 300_000 }],
    });
    expect(waiting.recordStatus).toBe("SUBMITTED");

    // The comparison window: the 1st of last month.
    await revenue("DLA", comparisonDay, [{ assetId: trucks.t1, amountMinor: 200_000 }]);
    await expense("DLA", "FUEL", comparisonDay, [{ assetId: trucks.t1, amountMinor: 90_000 }]);
    await expense("DLA", "INSURANCE", comparisonDay, [{ amountMinor: 10_000 }]);

    // Trips: T1 closed with 245 + 100 km, T2 closed with no km, T1 still open.
    await trip(trucks.t1, [245, 100], true);
    await trip(trucks.t2, [undefined], true);
    await trip(trucks.t1, [50], false);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it("totals the period and the same days of last month, posted entries only", async () => {
    const body = await overview(actors.DIRECTOR);
    expect(body.view).toBe("PROFIT");
    expect(body.currency).toBe("XAF");
    expect(body.period).toEqual({ from: periodDay, to: today, revenueMinor: 840_000, expenseMinor: 495_000, profitMinor: 345_000 });
    expect(body.comparison).toMatchObject({ from: comparisonDay, revenueMinor: 200_000, expenseMinor: 100_000, profitMinor: 100_000 });
    for (const amount of [body.period.revenueMinor, body.period.expenseMinor]) {
      expect(Number.isSafeInteger(amount)).toBe(true);
    }
  });

  it("returns 12 months of revenue and expenses, zero-filled", async () => {
    const body = await overview(actors.DIRECTOR);
    expect(body.series).toHaveLength(12);
    expect(body.series.at(-1)).toEqual({ periodCode: shiftMonth(month, -1), revenueMinor: 200_000, expenseMinor: 100_000 });
    expect(body.series.slice(0, -1).every((point) => point.revenueMinor === 0 && point.expenseMinor === 0)).toBe(true);
    // The current month is not a closed month: it is the period, not a point.
    expect(body.series.some((point) => point.periodCode === month)).toBe(false);
  });

  it("returns expenses by category for both windows, with the company part", async () => {
    const body = await overview(actors.DIRECTOR);
    const byCode = Object.fromEntries(body.expensesByCategory.map((row) => [row.code, row]));
    expect(byCode.FUEL).toMatchObject({
      period: { expenseMinor: 330_000, companyCostMinor: 0 },
      comparison: { expenseMinor: 90_000, companyCostMinor: 0 },
    });
    expect(byCode.REPAIRS).toMatchObject({ period: { expenseMinor: 80_000 }, comparison: { expenseMinor: 0 } });
    expect(byCode.INSURANCE).toMatchObject({
      period: { expenseMinor: 85_000, companyCostMinor: 85_000 },
      comparison: { expenseMinor: 10_000, companyCostMinor: 10_000 },
    });
    expect(body.expensesByCategory.map((row) => row.code)).toEqual(["FUEL", "INSURANCE", "REPAIRS"]);
    expect(body.expensesByCategory.reduce((sum, row) => sum + row.period.expenseMinor, 0)).toBe(body.period.expenseMinor);
  });

  it("returns each vehicle's trips, km, revenue, expenses and profit, losses first", async () => {
    const body = await overview(actors.DIRECTOR);
    const rows = body.vehicles!.map(({ assetCode, tripsClosed, distanceKm, tripsWithoutKm, revenueMinor, expenseMinor, profitMinor }) => ({
      assetCode, tripsClosed, distanceKm, tripsWithoutKm, revenueMinor, expenseMinor, profitMinor,
    }));
    expect(rows).toEqual([
      { assetCode: "T2", tripsClosed: 1, distanceKm: null, tripsWithoutKm: 1, revenueMinor: 0, expenseMinor: 100_000, profitMinor: -100_000 },
      { assetCode: "T4", tripsClosed: 0, distanceKm: null, tripsWithoutKm: 0, revenueMinor: 0, expenseMinor: 0, profitMinor: 0 },
      { assetCode: "T3", tripsClosed: 0, distanceKm: null, tripsWithoutKm: 0, revenueMinor: 300_000, expenseMinor: 100_000, profitMinor: 200_000 },
      { assetCode: "T1", tripsClosed: 1, distanceKm: 345, tripsWithoutKm: 0, revenueMinor: 500_000, expenseMinor: 210_000, profitMinor: 290_000 },
    ]);
    expect(body.branches).toEqual([
      { branchId: yaoundeId, code: "YDE", name: "Yaoundé", vehicleCount: 1, revenueMinor: 300_000, expenseMinor: 100_000, vehicleProfitMinor: 200_000 },
      { branchId: doualaId, code: "DLA", name: "Douala", vehicleCount: 3, revenueMinor: 500_000, expenseMinor: 310_000, vehicleProfitMinor: 190_000 },
    ]);
  });

  it("company profit is the vehicles' profit less company costs", async () => {
    const body = await overview(actors.DIRECTOR);
    expect(body.companyProfit).toEqual({
      period: { vehicleProfitMinor: 390_000, revenueWithoutVehicleMinor: 40_000, companyCostsMinor: 85_000, companyProfitMinor: 345_000 },
      comparison: { vehicleProfitMinor: 110_000, revenueWithoutVehicleMinor: 0, companyCostsMinor: 10_000, companyProfitMinor: 100_000 },
    });
    expectIdentity(body);

    // Yaoundé has no revenue off a truck: company profit is exactly the
    // vehicles' profit minus company costs.
    const yaounde = await overview(actors.DIRECTOR, `?branchId=${yaoundeId}`);
    const company = yaounde.companyProfit!.period;
    expect(company.revenueWithoutVehicleMinor).toBe(0);
    expect(company.companyProfitMinor).toBe(
      yaounde.vehicles!.reduce((sum, vehicle) => sum + vehicle.profitMinor, 0) - company.companyCostsMinor,
    );
    expect(company).toEqual({ vehicleProfitMinor: 200_000, revenueWithoutVehicleMinor: 0, companyCostsMinor: 25_000, companyProfitMinor: 175_000 });
    expectIdentity(yaounde);
  });

  it("counts what was not counted: waiting, missing receipts, open trips", async () => {
    const body = await overview(actors.DIRECTOR);
    expect(body.counted).toEqual({ postedEntries: 11, closedTrips: 2 });
    expect(body.notCounted.waitingApproval).toEqual({ count: 1, amountMinor: 300_000 });
    expect(body.notCounted.openTrips).toBe(1);
    expect(body.notCounted.otherCurrencyEntries).toBe(0);

    // The same entries the list's "missing receipt" filter finds this month,
    // less the rejected (none here).
    const listed = await api.get(actors.DIRECTOR.token, `/v1/finance/entries?evidence=MISSING&economicMonth=${month}&limit=100`);
    expect(listed.status).toBe(200);
    const missing = (listed.body as { entries: { amountMinor: number }[] }).entries;
    expect(missing.length).toBeGreaterThan(0);
    expect(body.notCounted.missingReceipt).toEqual({
      count: missing.length,
      amountMinor: missing.reduce((sum, entry) => sum + Math.abs(entry.amountMinor), 0),
    });
  });

  it("ranges over closed months for 3 and 12 months", async () => {
    const three = await overview(actors.DIRECTOR, "?range=THREE_MONTHS");
    expect(three.period).toMatchObject({ from: `${shiftMonth(month, -3)}-01`, revenueMinor: 200_000, expenseMinor: 100_000, profitMinor: 100_000 });
    expect(three.comparison).toMatchObject({ revenueMinor: 0, expenseMinor: 0 });
    expectIdentity(three);
    const twelve = await overview(actors.DIRECTOR, "?range=TWELVE_MONTHS");
    expect(twelve.period).toMatchObject({ from: `${shiftMonth(month, -12)}-01`, revenueMinor: 200_000 });
  });

  it("serves finance the same books", async () => {
    const director = await overview(actors.DIRECTOR);
    const finance = await overview(actors.FINANCE);
    expect(finance).toEqual(director);
  });

  it("keeps an administrator inside their branches, and a narrowing never widens", async () => {
    const body = await overview(actors.ADMIN);
    expect(body.view).toBe("PROFIT");
    expect(body.period).toMatchObject({ revenueMinor: 540_000, expenseMinor: 370_000, profitMinor: 170_000 });
    expect(body.vehicles!.map((vehicle) => vehicle.assetCode).sort()).toEqual(["T1", "T2", "T4"]);
    expect(body.branches!.map((branch) => branch.code)).toEqual(["DLA"]);
    expect(body.companyProfit!.period.companyCostsMinor).toBe(60_000);
    expectIdentity(body);

    const outside = await overview(actors.ADMIN, `?branchId=${yaoundeId}`);
    expect(outside.period).toMatchObject({ revenueMinor: 0, expenseMinor: 0, profitMinor: 0 });
    expect(outside.vehicles).toEqual([]);
    expect(outside.branches).toEqual([]);
    expect(outside.expensesByCategory).toEqual([]);
    expect(outside.notCounted.openTrips).toBe(0);
  });

  it("gives the cashier the branch's revenue and expenses, and no profit anywhere", async () => {
    const body = await overview(actors.CASHIER);
    expect(body.view).toBe("REVENUE_AND_EXPENSES");
    expect(body.period).toMatchObject({ revenueMinor: 540_000, expenseMinor: 370_000, profitMinor: null });
    expect(body.comparison.profitMinor).toBeNull();
    expect(body.vehicles).toBeNull();
    expect(body.branches).toBeNull();
    expect(body.companyProfit).toBeNull();
    expect(body.expensesByCategory.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/profitMinor":-?\d/i);
  });

  it("refuses every other role", async () => {
    for (const role of ["TECHNICIAN", "DRIVER"] as const) {
      const reply = await api.get(actors[role].token, "/v1/finance/overview");
      expect(reply.status, role).toBe(403);
      expect(reply.body, role).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    }
  });

  it("refuses an unknown range", async () => {
    const reply = await api.get(actors.DIRECTOR.token, "/v1/finance/overview?range=WEEK");
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
  });

  it("drops trip figures while Trips is off", async () => {
    await setModule(ctx.db, workspaceId, "ACTIVITIES", false);
    try {
      const body = await overview(actors.DIRECTOR);
      expect(body.counted.closedTrips).toBeNull();
      expect(body.notCounted.openTrips).toBeNull();
      expect(body.vehicles!.every((vehicle) => vehicle.tripsClosed === null && vehicle.distanceKm === null)).toBe(true);
      expect(body.period.profitMinor).toBe(345_000);
    } finally {
      await setModule(ctx.db, workspaceId, "ACTIVITIES", true);
    }
  });

  it("answers MODULE_DISABLED once FINANCE is off", async () => {
    const other = await seedWorkspace(ctx.db);
    const director = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "DIRECTOR" });
    await setModule(ctx.db, other.workspace.id, "FINANCE", false);
    const reply = await api.get(director.token, "/v1/finance/overview");
    expect(reply.status).toBe(403);
    expect(reply.body).toEqual({ error: { code: "MODULE_DISABLED", metadata: { module: "FINANCE" } } });
  });
});
