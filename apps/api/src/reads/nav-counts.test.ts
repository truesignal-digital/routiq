import { randomUUID } from "node:crypto";
import { navCountsResponse, type NavCountsResponse } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/** Above every recording band, so the entry waits for a decision. */
const WAITING_AMOUNT = 5_000_000;

describe("GET /v1/nav-counts", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let director: Actor;
  let admin: Actor;
  let finance: Actor;
  let dlaFinance: Actor;
  let ydeFinance: Actor;
  let technician: Actor;
  let ydeTechnician: Actor;
  let driver: Actor;
  let cashier: Actor;

  async function counts(actor: Actor): Promise<NavCountsResponse> {
    const response = await api.get(actor.token, "/v1/nav-counts");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return navCountsResponse.parse(response.body);
  }

  async function recordExpense(actor: Actor, truck: string, branchCode = "DLA") {
    const recorded = await api.ok(actor.token, "record-expense", {
      entryId: randomUUID(),
      branchCode,
      categoryCode: "FUEL",
      economicDate: "2026-09-02",
      amountMinor: WAITING_AMOUNT,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor: WAITING_AMOUNT }],
    });
    expect(recorded.recordStatus).toBe("SUBMITTED");
  }

  async function reportIssue(actor: Actor, truck: string): Promise<string> {
    const issueId = randomUUID();
    await api.ok(actor.token, "report-issue", {
      issueId,
      assetId: truck,
      description: "Freins qui grincent",
      safetyCritical: false,
    });
    return issueId;
  }

  let dlaTruck: string;
  let ydeTruck: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    dlaFinance = await seedActor(ctx.db, { workspaceId, role: "FINANCE", branchIds: [seeded.branch.id] });
    ydeFinance = await seedActor(ctx.db, { workspaceId, role: "FINANCE", branchIds: [yaounde!.id] });
    technician = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    ydeTechnician = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN", branchIds: [yaounde!.id] });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER" });

    dlaTruck = await seedAsset(ctx.app, director.token, { branchCode: "DLA" });
    ydeTruck = await seedAsset(ctx.app, director.token, { branchCode: "YDE" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("counts only where the role acts: Money for the approvers, Maintenance for the workshop", async () => {
    expect(await counts(director)).toEqual({ moneyWaiting: 0, maintenanceNew: 0 });
    expect(await counts(finance)).toEqual({ moneyWaiting: 0, maintenanceNew: null });
    expect(await counts(admin)).toEqual({ moneyWaiting: null, maintenanceNew: 0 });
    expect(await counts(technician)).toEqual({ moneyWaiting: null, maintenanceNew: 0 });
    expect(await counts(driver)).toEqual({ moneyWaiting: null, maintenanceNew: null });
    expect(await counts(cashier)).toEqual({ moneyWaiting: null, maintenanceNew: null });
  });

  it("counts waiting expenses in the caller's branches and never the caller's own", async () => {
    await recordExpense(driver, dlaTruck);
    await recordExpense(finance, dlaTruck);
    await recordExpense(driver, ydeTruck, "YDE");

    // Three wait; the one finance recorded waits on someone else.
    expect((await counts(director)).moneyWaiting).toBe(3);
    expect((await counts(finance)).moneyWaiting).toBe(2);
    expect((await counts(dlaFinance)).moneyWaiting).toBe(2);
    expect((await counts(ydeFinance)).moneyWaiting).toBe(1);
  });

  it("counts open problems in the caller's branches until a work order takes them", async () => {
    const brakes = await reportIssue(driver, dlaTruck);
    await reportIssue(driver, ydeTruck);
    const dismissed = await reportIssue(driver, dlaTruck);
    const reported = await api.get(director.token, `/v1/issues/${dismissed}`);
    const rowVersion = (reported.body as { rowVersion: number }).rowVersion;
    await api.ok(technician.token, "dismiss-issue", { issueId: dismissed, reason: "Doublon" }, { expectedVersion: rowVersion });

    expect((await counts(technician)).maintenanceNew).toBe(2);
    expect((await counts(ydeTechnician)).maintenanceNew).toBe(1);

    await api.ok(technician.token, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: dlaTruck,
      issueId: brakes,
      description: "Plaquettes",
      expectedCostMinor: 10_000,
    });
    expect((await counts(technician)).maintenanceNew).toBe(1);
    expect((await counts(admin)).maintenanceNew).toBe(1);
  });

  it("returns no count for a module that is off", async () => {
    for (const moduleCode of ["FINANCE", "MAINTENANCE"] as const) {
      await setModule(ctx.db, workspaceId, moduleCode, false);
    }
    expect(await counts(director)).toEqual({ moneyWaiting: null, maintenanceNew: null });
    expect(await counts(technician)).toEqual({ moneyWaiting: null, maintenanceNew: null });
  });
});
