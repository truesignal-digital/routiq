import { randomUUID } from "node:crypto";
import { assetDetail } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/**
 * The demo's payoff question — "did Camion 03 make money?" — so the money math
 * is what this suite guards: signed postings, ledger statuses only, and one
 * asset's lines never bleeding into another's.
 */
describe("GET /v1/assets/:assetId", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let adminToken: string;
  let yaoundeScopedToken: string;
  let submitterToken: string;
  let otherWorkspaceToken: string;

  /** The asset under test: DLA, with revenue, two expense categories, activities. */
  let camionId: string;
  /** A second DLA asset whose money must never land on `camionId`. */
  let otherAssetId: string;
  let otherWorkspaceAssetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");

    const admin = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(ctx.db, {
        principalId: admin.principal.id,
        workspaceId,
      })
    ).token;

    const yaoundeOnly = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      branchIds: [yaounde.id],
    });
    yaoundeScopedToken = (
      await createSession(ctx.db, {
        principalId: yaoundeOnly.principal.id,
        workspaceId,
      })
    ).token;

    const submitter = await seedMember(ctx.db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      allBranches: true,
    });
    submitterToken = (
      await createSession(ctx.db, {
        principalId: submitter.principal.id,
        workspaceId,
      })
    ).token;

    const otherWorkspace = await seedWorkspace(ctx.db);
    const otherAdmin = await seedMember(ctx.db, {
      workspaceId: otherWorkspace.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    otherWorkspaceToken = (
      await createSession(ctx.db, {
        principalId: otherAdmin.principal.id,
        workspaceId: otherWorkspace.workspace.id,
      })
    ).token;

    camionId = await registerAsset(adminToken, "CAMION-03", "DLA");
    otherAssetId = await registerAsset(adminToken, "CAMION-04", "DLA");
    otherWorkspaceAssetId = await registerAsset(
      otherWorkspaceToken,
      "CAMION-99",
      "DLA",
    );

    await recordEntry(adminToken, "record-revenue", {
      amountMinor: 900_000,
      categoryCode: "FREIGHT_REVENUE",
      assetId: camionId,
      expectStatus: "POSTED",
    });
    await recordEntry(adminToken, "record-expense", {
      amountMinor: 250_000,
      categoryCode: "FUEL",
      assetId: camionId,
      expectStatus: "POSTED",
    });
    await recordEntry(adminToken, "record-expense", {
      amountMinor: 60_000,
      categoryCode: "FUEL",
      assetId: camionId,
      expectStatus: "POSTED",
    });
    await recordEntry(adminToken, "record-expense", {
      amountMinor: 90_000,
      categoryCode: "REPAIRS",
      assetId: camionId,
      expectStatus: "POSTED",
    });

    // Above the auto-post threshold for a FIELD_SUBMITTER: stays SUBMITTED and
    // must stay out of the totals until somebody approves it.
    await recordEntry(submitterToken, "record-expense", {
      amountMinor: 400_000,
      categoryCode: "REPAIRS",
      assetId: camionId,
      expectStatus: "SUBMITTED",
    });

    // Another asset's fuel, and a posting with no asset at all.
    await recordEntry(adminToken, "record-expense", {
      amountMinor: 500_000,
      categoryCode: "FUEL",
      assetId: otherAssetId,
      expectStatus: "POSTED",
    });
    await recordEntry(adminToken, "record-expense", {
      amountMinor: 700_000,
      categoryCode: "INSURANCE",
      expectStatus: "POSTED",
    });

    await createActivity(adminToken, {
      assetId: camionId,
      activityNumberHint: "first",
      startedAt: "2026-07-10T06:00:00Z",
      customerName: "Brasseries",
    });
    await createActivity(adminToken, {
      assetId: camionId,
      activityNumberHint: "second",
      startedAt: "2026-07-18T06:00:00Z",
      customerName: "Cimencam",
    });
    await createActivity(adminToken, {
      assetId: otherAssetId,
      activityNumberHint: "other",
      startedAt: "2026-07-19T06:00:00Z",
      customerName: "Ailleurs",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("returns the asset's identity, branch and category", async () => {
    const body = await fetchAsset(adminToken, camionId);

    expect(body).toMatchObject({
      id: camionId,
      assetCode: "CAMION-03",
      lifecycleStatus: "REGISTERED",
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      currency: "XAF",
      branch: { code: "DLA", name: "Douala" },
    });
    expect(body.category.labelFr).toBe("Camion");
  });

  it("sums only this asset's posted lines into revenue, expense and net", async () => {
    const body = await fetchAsset(adminToken, camionId);

    // 250_000 + 60_000 fuel + 90_000 repairs. The 400_000 SUBMITTED repair, the
    // other asset's 500_000 fuel and the unattributed 700_000 are all excluded.
    expect(body.finance).toMatchObject({
      currency: "XAF",
      revenueMinor: 900_000,
      expenseMinor: 400_000,
      netMinor: 500_000,
    });
  });

  it("breaks expenses down by category, largest first", async () => {
    const body = await fetchAsset(adminToken, camionId);

    expect(
      body.finance.expenseByCategory.map(({ code, totalMinor }) => [
        code,
        totalMinor,
      ]),
    ).toEqual([
      ["FUEL", 310_000],
      ["REPAIRS", 90_000],
    ]);
    expect(body.finance.expenseByCategory[0]).toMatchObject({
      labelFr: "Carburant",
      labelEn: "Fuel",
    });
  });

  it("subtracts a reversal instead of counting it as a second charge", async () => {
    const before = await fetchAsset(adminToken, camionId);

    const { entryId, rowVersion } = await recordEntry(
      adminToken,
      "record-expense",
      {
        amountMinor: 45_000,
        categoryCode: "TOLLS",
        assetId: camionId,
        expectStatus: "POSTED",
      },
    );

    const posted = await fetchAsset(adminToken, camionId);
    expect(posted.finance.expenseMinor).toBe(before.finance.expenseMinor + 45_000);
    expect(posted.finance.netMinor).toBe(before.finance.netMinor - 45_000);
    expect(
      posted.finance.expenseByCategory.find(({ code }) => code === "TOLLS"),
    ).toMatchObject({ totalMinor: 45_000 });

    const reversal = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/reverse-entry",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `reverse-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: rowVersion,
        },
        payload: {
          reversalEntryId: randomUUID(),
          originalEntryId: entryId,
          reason: "duplicate capture",
        },
      },
    });
    expect(reversal.statusCode).toBe(200);

    const after = await fetchAsset(adminToken, camionId);
    expect(after.finance.expenseMinor).toBe(before.finance.expenseMinor);
    expect(after.finance.netMinor).toBe(before.finance.netMinor);
    // A category netted back to zero is gone, not shown as a 0 XAF cost.
    expect(
      after.finance.expenseByCategory.some(({ code }) => code === "TOLLS"),
    ).toBe(false);
  });

  it("lists this asset's activities, most recent first", async () => {
    const body = await fetchAsset(adminToken, camionId);

    expect(body.recentActivities.map((a) => a.customerName)).toEqual([
      "Cimencam",
      "Brasseries",
    ]);
    expect(body.recentActivities[0]).toMatchObject({
      status: "OPEN",
      activityType: { code: "HAULAGE_JOB" },
    });
  });

  it("answers 404 for an asset in another workspace", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/assets/${otherWorkspaceAssetId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
  });

  it("answers 404, not 403, for an asset outside the caller's branch scope", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/assets/${camionId}`,
      headers: { authorization: `Bearer ${yaoundeScopedToken}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
  });

  it("rejects a malformed asset id before touching the database", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/assets/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/assets/${camionId}`,
    });

    expect(response.statusCode).toBe(401);
  });

  async function fetchAsset(token: string, assetId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/assets/${assetId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return assetDetail.parse(response.json());
  }

  async function command(
    token: string,
    name: string,
    payload: Record<string, unknown>,
  ) {
    const response = await ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `asset-detail-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(`${name} failed: ${response.statusCode} ${response.body}`);
    }
    return response.json() as { recordStatus?: string; rowVersion: number };
  }

  async function registerAsset(
    token: string,
    assetCode: string,
    branchCode: string,
  ) {
    const assetId = randomUUID();
    await command(token, "register-asset", {
      assetId,
      assetCode,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode,
    });
    return assetId;
  }

  async function recordEntry(
    token: string,
    name: "record-expense" | "record-revenue",
    opts: {
      amountMinor: number;
      categoryCode: string;
      assetId?: string;
      expectStatus: "POSTED" | "SUBMITTED";
    },
  ) {
    const entryId = randomUUID();
    const body = await command(token, name, {
      entryId,
      branchCode: "DLA",
      categoryCode: opts.categoryCode,
      economicDate: "2026-07-15",
      amountMinor: opts.amountMinor,
      paymentMethod: "CASH",
      postings: [
        opts.assetId === undefined
          ? { amountMinor: opts.amountMinor }
          : { assetId: opts.assetId, amountMinor: opts.amountMinor },
      ],
    });
    expect(body.recordStatus).toBe(opts.expectStatus);
    return { entryId, rowVersion: body.rowVersion };
  }

  async function createActivity(
    token: string,
    opts: {
      assetId: string;
      activityNumberHint: string;
      startedAt: string;
      customerName: string;
    },
  ) {
    const activityId = randomUUID();
    await command(token, "create-activity", {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: opts.assetId,
      startedAt: opts.startedAt,
      customerName: opts.customerName,
    });
    return activityId;
  }
});
