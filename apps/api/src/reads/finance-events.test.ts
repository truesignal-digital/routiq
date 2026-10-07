import { randomUUID } from "node:crypto";
import {
  activityDetail,
  assetFinanceResponse,
  dashboardResponse,
  financialEntryListResponse,
  periodsResponse,
  type FinancialEntryListItem,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentPeriodCode } from "../commands/periods.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * #427: money lists show one line per real event. A cancellation in the same
 * month folds under its original, which then counts 0; one in a later month
 * stays its own line in that month, so each month's total stays honest. The
 * books view lists every signed row, as before.
 */
describe("GET /v1/finance/entries, one line per event (#427)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let director: Actor;
  let finance: Actor;
  let driver: Actor;
  let truck: string;
  let current: string;

  const MAY = "2026-05";

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR", displayName: "direction-427" });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE", displayName: "finance-427" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    truck = await seedAsset(ctx.app, director.token, { assetCode: "EVT-427" });
    current = currentPeriodCode(new Date(), "Africa/Douala");
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function record(actor: Actor, amountMinor: number, economicDate: string, extra: Record<string, unknown> = {}) {
    const entryId = randomUUID();
    const result = await api.ok(actor.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate,
      amountMinor,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor, ...extra }],
    });
    return { entryId, rowVersion: result.rowVersion };
  }

  async function cancel(entry: { entryId: string; rowVersion: number }, reason: string) {
    const reversalEntryId = randomUUID();
    await api.ok(
      finance.token,
      "reverse-entry",
      { reversalEntryId, originalEntryId: entry.entryId, reason },
      { expectedVersion: entry.rowVersion },
    );
    return reversalEntryId;
  }

  async function list(token: string, query: string): Promise<FinancialEntryListItem[]> {
    const response = await api.get(token, `/v1/finance/entries?limit=100&${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return financialEntryListResponse.parse(response.body).entries;
  }

  async function posted(periodCode: string) {
    const response = await api.get(director.token, `/v1/assets/${truck}/finance?periodCode=${periodCode}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return assetFinanceResponse.parse(response.body).posted;
  }

  async function postedExpense(periodCode: string): Promise<number> {
    return (await posted(periodCode)).expenseMinor;
  }

  /** What a line counts for: 0 when its cancellation is folded into it. */
  function lineTotal(entries: readonly FinancialEntryListItem[]): number {
    return entries.reduce(
      (sum, entry) => sum + (entry.cancelledBy?.folded === true ? 0 : entry.amountMinor),
      0,
    );
  }

  it("folds a same-month cancellation under its original, which counts 0", async () => {
    const kept = await record(director, 30_000, `${current}-02`);
    const twice = await record(director, 45_000, `${current}-03`);
    const reversalId = await cancel(twice, "Saisie en double");

    const events = await list(director.token, `periodCode=${current}&assetId=${truck}`);
    expect(events.map((entry) => entry.id)).not.toContain(reversalId);
    const original = events.find((entry) => entry.id === twice.entryId);
    expect(original).toMatchObject({
      status: "REVERSED",
      cancels: null,
      cancelledBy: {
        entryId: reversalId,
        postingPeriodCode: current,
        folded: true,
        reasonCode: null,
        reasonText: "Saisie en double",
        recordedBy: { displayName: "finance-427" },
      },
    });
    expect(original?.cancelledBy?.entryNumber).toMatch(/^DLA-/);
    expect(original?.cancelledBy?.postedAt).not.toBeNull();
    expect(events.find((entry) => entry.id === kept.entryId)?.cancelledBy).toBeNull();

    // Totals do not change: the lines add up to the posted figure.
    expect(lineTotal(events)).toBe(await postedExpense(current));
    // The Money tab's count is the lines it lists; the books count both rows.
    expect(await posted(current)).toMatchObject({ eventCount: events.length, entryCount: events.length + 1 });
  });

  it("lists both signed rows in the books view", async () => {
    const books = await list(director.token, `periodCode=${current}&assetId=${truck}&view=books`);
    const reversal = books.find((entry) => entry.reversesEntryId !== null);
    expect(reversal).toBeDefined();
    const original = books.find((entry) => entry.id === reversal?.reversesEntryId);
    // Neither row is folded in the books: each counts its own signed amount.
    expect(original?.cancelledBy).toMatchObject({ entryId: reversal?.id, folded: false });
    expect(reversal?.cancels).toMatchObject({ entryId: original?.id, postingPeriodCode: current });
    expect(books.reduce((sum, entry) => sum + entry.amountMinor, 0)).toBe(await postedExpense(current));
  });

  it("keeps a cancellation from a later month in that month, so each month stays honest", async () => {
    const may = await record(director, 80_000, `${MAY}-14`);
    const periods = periodsResponse.parse((await api.get(director.token, "/v1/finance/periods")).body);
    await api.ok(
      director.token,
      "lock-period",
      { periodCode: MAY },
      { expectedVersion: periods.periods.find((period) => period.periodCode === MAY)!.rowVersion },
    );
    const reversalId = await cancel(may, "N'a pas eu lieu");

    // May: the entry still counts there, and says when it was cancelled.
    const inMay = await list(director.token, `periodCode=${MAY}&assetId=${truck}`);
    expect(inMay.map((entry) => entry.id)).toEqual([may.entryId]);
    expect(inMay[0]).toMatchObject({
      status: "REVERSED",
      cancelledBy: { entryId: reversalId, postingPeriodCode: current, folded: false },
    });
    expect(lineTotal(inMay)).toBe(80_000);
    expect(lineTotal(inMay)).toBe(await postedExpense(MAY));

    // The later month: the cancellation is its own line and subtracts there.
    const inCurrent = await list(director.token, `periodCode=${current}&assetId=${truck}`);
    const cancellation = inCurrent.find((entry) => entry.id === reversalId);
    expect(cancellation).toMatchObject({
      amountMinor: -80_000,
      reversesEntryId: may.entryId,
      cancels: { entryId: may.entryId, postingPeriodCode: MAY },
    });
    expect(cancellation?.cancels?.entryNumber).toMatch(/^DLA-/);
    expect(lineTotal(inCurrent)).toBe(await postedExpense(current));
    expect((await posted(MAY)).eventCount).toBe(inMay.length);
    expect((await posted(current)).eventCount).toBe(inCurrent.length);

    // The dashboard's open-period figure is the same sum, over the whole workspace.
    const dashboard = dashboardResponse.parse((await api.get(director.token, "/v1/dashboard")).body);
    const allCurrent = await list(director.token, `periodCode=${current}&status=LEDGER`);
    expect(dashboard.openPeriod?.periodCode).toBe(current);
    expect(lineTotal(allCurrent)).toBe(dashboard.openPeriod?.postedExpenseMinor);

    // Without a month, the whole list is one window: the pair folds.
    const allTime = await list(director.token, `assetId=${truck}`);
    expect(allTime.map((entry) => entry.id)).not.toContain(reversalId);
    expect(allTime.find((entry) => entry.id === may.entryId)?.cancelledBy).toMatchObject({ folded: true });
  });

  it("applies the money read scope to the cancellation too", async () => {
    // A driver's own entry, cancelled by Finance: the driver reads their line,
    // never Finance's row or who cancelled it and why.
    const own = await record(driver, 4_000, `${current}-04`);
    const reviewed = await api.get(finance.token, `/v1/finance/entries/${own.entryId}`);
    const rowVersion = (reviewed.body as { rowVersion: number; status: string }).rowVersion;
    if ((reviewed.body as { status: string }).status === "SUBMITTED") {
      await api.ok(finance.token, "approve-entry", { entryId: own.entryId }, { expectedVersion: rowVersion });
    }
    const posted = await api.get(finance.token, `/v1/finance/entries/${own.entryId}`);
    const reversalId = await cancel(
      { entryId: own.entryId, rowVersion: (posted.body as { rowVersion: number }).rowVersion },
      "Erreur de saisie",
    );

    const mine = await list(driver.token, `periodCode=${current}`);
    expect(mine.map((entry) => entry.id)).toEqual([own.entryId]);
    expect(mine[0]).toMatchObject({ status: "REVERSED", cancelledBy: null });
    expect((await list(driver.token, `periodCode=${current}&view=books`)).map((entry) => entry.id)).not.toContain(
      reversalId,
    );
  });

  it("refuses an unknown view", async () => {
    const response = await api.get(director.token, "/v1/finance/entries?view=sideways");
    expect(response.status).toBe(400);
  });
});

describe("GET /v1/activities/:id, the trip's cancellations (#427)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("names the cancellation on the original and links the cancellation back", async () => {
    const seeded = await seedWorkspace(ctx.db);
    const director = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "DIRECTOR" });
    const truck = await seedAsset(ctx.app, director.token, { assetCode: "TRIP-427" });
    const tripId = randomUUID();
    await api.ok(director.token, "create-activity", {
      activityId: tripId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: truck,
      startedAt: "2026-08-12T05:00:00Z",
    });
    const entryId = randomUUID();
    const recorded = await api.ok(director.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-12",
      amountMinor: 12_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, activityId: tripId, amountMinor: 12_000 }],
    });
    const reversalEntryId = randomUUID();
    await api.ok(
      director.token,
      "reverse-entry",
      { reversalEntryId, originalEntryId: entryId, reason: "Mauvais trajet" },
      { expectedVersion: recorded.rowVersion },
    );

    const response = await api.get(director.token, `/v1/activities/${tripId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const entries = activityDetail.parse(response.body).financialEntries ?? [];
    expect(entries.find((entry) => entry.entryId === entryId)).toMatchObject({
      status: "REVERSED",
      reversesEntryId: null,
      cancelledBy: { entryId: reversalEntryId, reasonText: "Mauvais trajet", folded: true },
    });
    expect(entries.find((entry) => entry.entryId === reversalEntryId)).toMatchObject({
      amountMinor: -12_000,
      reversesEntryId: entryId,
      cancelledBy: null,
    });
  });
});
