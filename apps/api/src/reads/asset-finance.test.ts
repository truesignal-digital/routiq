import { randomUUID } from "node:crypto";
import { assetFinanceResponse, periodsResponse, type AssetFinanceResponse } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentPeriodCode } from "../commands/periods.js";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { shiftMonth } from "./asset-finance.js";

/**
 * One vehicle's month in money (PLAN §1.3): exact XAF, each figure on its named
 * basis, the vehicle's signed share only, entries read by their own branch.
 */
describe("GET /v1/assets/:assetId/finance", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let approver: Actor;
  let driver: Actor;
  let mechanic: Actor;
  let director: Actor;
  let dlaReader: Actor;
  let ydeOnly: Actor;
  let outsider: Actor;
  let truck: string;
  let otherTruck: string;

  const JULY = "2026-07";

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    admin = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    // Above the recording band an entry is Direction's to decide.
    approver = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    dlaReader = await seedActor(ctx.db, {
      workspaceId,
      role: "DRIVER",
      branchIds: [seeded.branch.id],
    });
    ydeOnly = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [yaounde!.id] });
    const other = await seedWorkspace(ctx.db);
    outsider = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });

    truck = await seedAsset(ctx.app, admin.token, { assetCode: "FIN-A" });
    otherTruck = await seedAsset(ctx.app, admin.token, { assetCode: "FIN-B" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function finance(token: string, query = `?periodCode=${JULY}`, assetId = truck) {
    const response = await api.get(token, `/v1/assets/${assetId}/finance${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return assetFinanceResponse.parse(response.body);
  }

  async function record(
    actor: Actor,
    opts: {
      amountMinor: number;
      categoryCode?: string;
      direction?: "record-expense" | "record-revenue";
      economicDate?: string;
      branchCode?: string;
      postings?: Array<Record<string, unknown>>;
    },
  ) {
    const entryId = randomUUID();
    const result = await api.ok(actor.token, opts.direction ?? "record-expense", {
      entryId,
      branchCode: opts.branchCode ?? "DLA",
      categoryCode: opts.categoryCode ?? "REPAIRS",
      economicDate: opts.economicDate ?? "2026-07-10",
      amountMinor: opts.amountMinor,
      paymentMethod: "CASH",
      postings: opts.postings ?? [{ assetId: truck, amountMinor: opts.amountMinor }],
    });
    return { entryId, rowVersion: result.rowVersion, status: result.recordStatus };
  }

  it("follows the contract's worked scenario to the franc", async () => {
    // A field submitter's 150 000 is above the auto band: pending, not posted.
    const brakes = await record(driver, { amountMinor: 150_000 });
    expect(brakes.status).toBe("SUBMITTED");
    let body = await finance(admin.token);
    expect(body.pending).toEqual({ basis: "ECONOMIC_MONTH", expenseMinor: 150_000, entryCount: 1 });
    expect(body.posted).toEqual({
      basis: "POSTING_PERIOD",
      expenseMinor: 0,
      revenueMinor: 0,
      entryCount: 0,
    });
    expect(body.evidenceMissing).toEqual({ postedCount: 0, pendingCount: 1 });

    const approved = await api.ok(
      approver.token,
      "approve-entry",
      { entryId: brakes.entryId },
      { expectedVersion: brakes.rowVersion },
    );
    body = await finance(admin.token);
    expect(body.posted).toMatchObject({ expenseMinor: 150_000, entryCount: 1 });
    expect(body.pending).toMatchObject({ expenseMinor: 0, entryCount: 0 });
    expect(body.periodStatus).toBe("OPEN");
    expect(body.evidenceMissing).toEqual({ postedCount: 1, pendingCount: 0 });

    // Reversed in the same (open) month: both lines count, and net to zero.
    await api.ok(
      approver.token,
      "reverse-entry",
      { reversalEntryId: randomUUID(), originalEntryId: brakes.entryId, reason: "Doublon" },
      { expectedVersion: approved.rowVersion },
    );
    body = await finance(admin.token);
    expect(body.posted).toMatchObject({ expenseMinor: 0, entryCount: 2 });
    expect(body.byCategory).toEqual([]);
    // The reversal row never counts as missing paperwork.
    expect(body.evidenceMissing.postedCount).toBe(1);
  });

  it("books a reversal of a locked month into the current one — or refuses if that is locked too", async () => {
    const may = await record(admin, { amountMinor: 80_000, economicDate: "2026-05-14" });
    const periods = periodsResponse.parse((await api.get(admin.token, "/v1/finance/periods")).body);
    await api.ok(
      admin.token,
      "lock-period",
      { periodCode: "2026-05" },
      { expectedVersion: periods.periods.find((p) => p.periodCode === "2026-05")!.rowVersion },
    );
    await api.ok(
      approver.token,
      "reverse-entry",
      { reversalEntryId: randomUUID(), originalEntryId: may.entryId, reason: "Mauvais camion" },
      { expectedVersion: may.rowVersion },
    );

    const current = currentPeriodCode(new Date(), "Africa/Douala");
    const mayBody = await finance(admin.token, "?periodCode=2026-05");
    expect(mayBody).toMatchObject({ periodStatus: "LOCKED", posted: { expenseMinor: 80_000 } });
    const nowBody = await finance(admin.token, `?periodCode=${current}`);
    expect(nowBody.posted.expenseMinor).toBe(-80_000);

    // With the current month locked as well, the reversal has nowhere to go.
    const june = await record(admin, { amountMinor: 20_000, economicDate: "2026-06-03" });
    const refreshed = periodsResponse.parse((await api.get(admin.token, "/v1/finance/periods")).body);
    for (const code of ["2026-06", current]) {
      const row = refreshed.periods.find((p) => p.periodCode === code);
      await api.ok(admin.token, "lock-period", { periodCode: code }, row ? { expectedVersion: row.rowVersion } : {});
    }
    const refused = await api.send(
      approver.token,
      "reverse-entry",
      { reversalEntryId: randomUUID(), originalEntryId: june.entryId, reason: "Erreur" },
      { expectedVersion: june.rowVersion },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("PERIOD_LOCKED");
  });

  it("counts only this vehicle's share of a split entry", async () => {
    await record(admin, {
      amountMinor: 100_000,
      categoryCode: "FUEL",
      economicDate: "2026-04-08",
      postings: [
        { assetId: truck, amountMinor: 60_000 },
        { assetId: otherTruck, amountMinor: 40_000 },
      ],
    });
    expect((await finance(admin.token, "?periodCode=2026-04")).posted.expenseMinor).toBe(60_000);
    expect((await finance(admin.token, "?periodCode=2026-04", otherTruck)).posted.expenseMinor).toBe(
      40_000,
    );
  });

  it("keeps rejected money out of both totals and counts it apart", async () => {
    const refused = await record(driver, { amountMinor: 300_000, economicDate: "2026-03-02" });
    await api.ok(
      approver.token,
      "reject-entry",
      { entryId: refused.entryId, reason: "Facture absente" },
      { expectedVersion: refused.rowVersion },
    );
    const body = await finance(admin.token, "?periodCode=2026-03");
    expect(body.posted.expenseMinor).toBe(0);
    expect(body.pending.expenseMinor).toBe(0);
    expect(body.rejected).toEqual({ basis: "ECONOMIC_MONTH", entryCount: 1 });
  });

  it("reads entries by their own branch, not the vehicle's", async () => {
    // Recorded under Yaoundé, charged to the Douala truck.
    await record(admin, { amountMinor: 45_000, economicDate: "2026-02-11", branchCode: "YDE" });
    await record(admin, { amountMinor: 5_000, economicDate: "2026-02-12" });
    expect((await finance(admin.token, "?periodCode=2026-02")).posted.expenseMinor).toBe(50_000);
    expect((await finance(dlaReader.token, "?periodCode=2026-02")).posted.expenseMinor).toBe(5_000);
  });

  it("breaks posted expense down by category, each with its layer, and zero-fills six months", async () => {
    await record(admin, { amountMinor: 30_000, categoryCode: "FUEL", economicDate: "2026-01-05" });
    await record(admin, { amountMinor: 70_000, categoryCode: "REPAIRS", economicDate: "2026-01-06" });
    await record(admin, {
      amountMinor: 900_000,
      categoryCode: "FREIGHT_REVENUE",
      direction: "record-revenue",
      economicDate: "2026-01-07",
    });
    const body: AssetFinanceResponse = await finance(admin.token, "?periodCode=2026-01");
    expect(body.byCategory).toEqual([
      { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs", layer: "MAINTENANCE", expenseMinor: 70_000 },
      { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT", expenseMinor: 30_000 },
    ]);
    expect(body.posted).toMatchObject({ expenseMinor: 100_000, revenueMinor: 900_000, entryCount: 3 });
    expect(body.layers).toEqual(["DIRECT", "MAINTENANCE", "OWNERSHIP", "SHARED"]);

    const march = await finance(admin.token, "?periodCode=2026-03");
    expect(march.series.map((point) => point.periodCode)).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(march.series.find((point) => point.periodCode === "2026-01")).toEqual({
      periodCode: "2026-01",
      expenseMinor: 100_000,
      revenueMinor: 900_000,
    });
    expect(march.series.find((point) => point.periodCode === "2025-11")).toEqual({
      periodCode: "2025-11",
      expenseMinor: 0,
      revenueMinor: 0,
    });
  });

  it("defaults to the current month in the workspace timezone", async () => {
    const body = await finance(admin.token, "");
    expect(body.periodCode).toBe(currentPeriodCode(new Date(), "Africa/Douala"));
    expect((await finance(admin.token, "?periodCode=2019-01")).periodStatus).toBe("NOT_STARTED");
  });

  it("serves the roles that read the books, and no other", async () => {
    for (const actor of [admin, approver, driver, director]) {
      expect((await api.get(actor.token, `/v1/assets/${truck}/finance`)).status).toBe(200);
    }
    const workshop = await api.get(mechanic.token, `/v1/assets/${truck}/finance`);
    expect(workshop.status).toBe(403);
    expect(workshop.body).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
  });

  it("refuses a malformed month", async () => {
    for (const query of ["?periodCode=2026-13", "?periodCode=July"]) {
      const response = await api.get(admin.token, `/v1/assets/${truck}/finance${query}`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
    }
  });

  it("answers 404 outside the caller's branches or workspace", async () => {
    for (const actor of [ydeOnly, outsider]) {
      const response = await api.get(actor.token, `/v1/assets/${truck}/finance`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    }
  });

  it("answers MODULE_DISABLED when FINANCE is off", async () => {
    const gated = await seedWorkspace(ctx.db);
    const gatedAdmin = await seedActor(ctx.db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
    const gatedTruck = await seedAsset(ctx.app, gatedAdmin.token);
    await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "FINANCE" });
    const response = await api.get(gatedAdmin.token, `/v1/assets/${gatedTruck}/finance`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: "MODULE_DISABLED", metadata: { module: "FINANCE" } },
    });
  });

  it("shifts months by string arithmetic across year ends", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-03", -5)).toBe("2025-10");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });
});
