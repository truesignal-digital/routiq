import { randomUUID } from "node:crypto";
import {
  dashboardResponse,
  pendingApprovalsResponse,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("GET /v1/dashboard", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("empty workspace", () => {
    let token: string;

    beforeAll(async () => {
      const seeded = await seedWorkspace(db);
      const admin = await seedMember(db, {
        workspaceId: seeded.workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      token = (
        await createSession(db, {
          principalId: admin.principal.id,
          workspaceId: seeded.workspace.id,
        })
      ).token;
    });

    it("reports zeros and no open period rather than omitting them", async () => {
      const body = await fetchDashboard(token);

      expect(body).toEqual({
        assets: {
          total: 0,
          byStatus: {
            REGISTERED: 0,
            IN_SERVICE: 0,
            UNDER_MAINTENANCE: 0,
            SOLD: 0,
            RETIRED: 0,
            WRITTEN_OFF: 0,
          },
        },
        openPeriod: null,
        pendingApprovals: { count: 0 },
      });
    });
  });

  describe("populated workspace", () => {
    /** Two branches, so branch scope has something to narrow. */
    let adminToken: string;
    let scopedToken: string;
    let submitterToken: string;
    let dlaAssetId: string;

    beforeAll(async () => {
      const seeded = await seedWorkspace(db);
      const workspaceId = seeded.workspace.id;
      const dlaBranchId = seeded.branch.id;

      const [yde] = await db
        .insert(branches)
        .values({ workspaceId, code: "YDE", name: "Yaoundé" })
        .returning();
      if (!yde) throw new Error("branch insert returned no row");

      const admin = await seedMember(db, {
        workspaceId,
        role: "ADMIN",
        allBranches: true,
      });
      adminToken = (
        await createSession(db, { principalId: admin.principal.id, workspaceId })
      ).token;

      const scoped = await seedMember(db, {
        workspaceId,
        role: "FINANCE_APPROVER",
        allBranches: false,
        branchIds: [dlaBranchId],
      });
      scopedToken = (
        await createSession(db, { principalId: scoped.principal.id, workspaceId })
      ).token;

      const submitter = await seedMember(db, {
        workspaceId,
        role: "FIELD_SUBMITTER",
        allBranches: true,
      });
      submitterToken = (
        await createSession(db, {
          principalId: submitter.principal.id,
          workspaceId,
        })
      ).token;

      // Three DLA assets, two YDE. One of each is commissioned, so both the
      // scoped and unscoped views have more than one status to report.
      const dlaAssets = [
        await registerAsset(adminToken, "DASH-DLA-1", "DLA"),
        await registerAsset(adminToken, "DASH-DLA-2", "DLA"),
        await registerAsset(adminToken, "DASH-DLA-3", "DLA"),
      ];
      dlaAssetId = dlaAssets[0]!.assetId;
      const ydeAssets = [
        await registerAsset(adminToken, "DASH-YDE-1", "YDE"),
        await registerAsset(adminToken, "DASH-YDE-2", "YDE"),
      ];
      await commissionAsset(adminToken, dlaAssets[0]!);
      await commissionAsset(adminToken, ydeAssets[0]!);

      // Posted into 2026-07: 50_000 + 30_000 expense, 200_000 revenue.
      await recordEntry(adminToken, "record-expense", {
        amountMinor: 50_000,
        branchCode: "DLA",
        categoryCode: "FUEL",
        assetId: dlaAssetId,
        expectStatus: "POSTED",
      });
      await recordEntry(adminToken, "record-expense", {
        amountMinor: 30_000,
        branchCode: "YDE",
        categoryCode: "FUEL",
        expectStatus: "POSTED",
      });
      await recordEntry(adminToken, "record-revenue", {
        amountMinor: 200_000,
        branchCode: "DLA",
        categoryCode: "FREIGHT_REVENUE",
        expectStatus: "POSTED",
      });

      // Above the 100_000 threshold a FIELD_SUBMITTER cannot auto-post: these
      // stay SUBMITTED, so they feed pendingApprovals and never the totals.
      await recordEntry(submitterToken, "record-expense", {
        amountMinor: 150_000,
        branchCode: "DLA",
        categoryCode: "FUEL",
        expectStatus: "SUBMITTED",
      });
      await recordEntry(submitterToken, "record-expense", {
        amountMinor: 250_000,
        branchCode: "YDE",
        categoryCode: "FUEL",
        expectStatus: "SUBMITTED",
      });
    });

    it("counts assets by lifecycle status across the whole workspace", async () => {
      const body = await fetchDashboard(adminToken);

      expect(body.assets).toEqual({
        total: 5,
        byStatus: {
          REGISTERED: 3,
          IN_SERVICE: 2,
          UNDER_MAINTENANCE: 0,
          SOLD: 0,
          RETIRED: 0,
          WRITTEN_OFF: 0,
        },
      });
    });

    it("narrows every count to a branch-scoped member's branches", async () => {
      const body = await fetchDashboard(scopedToken);

      expect(body.assets).toEqual({
        total: 3,
        byStatus: {
          REGISTERED: 2,
          IN_SERVICE: 1,
          UNDER_MAINTENANCE: 0,
          SOLD: 0,
          RETIRED: 0,
          WRITTEN_OFF: 0,
        },
      });
      // YDE's 30_000 expense and its 250_000 submission are both out of scope.
      expect(body.openPeriod).toMatchObject({
        postedExpenseMinor: 50_000,
        postedRevenueMinor: 200_000,
      });
      expect(body.pendingApprovals.count).toBe(1);
    });

    it("sums signed postings of the open period in the workspace currency", async () => {
      const body = await fetchDashboard(adminToken);

      expect(body.openPeriod).toEqual({
        periodCode: "2026-07",
        postedExpenseMinor: 80_000,
        postedRevenueMinor: 200_000,
        currency: "XAF",
      });
    });

    it("subtracts a reversal from the period total", async () => {
      const before = await fetchDashboard(adminToken);

      const { entryId, rowVersion } = await recordEntry(
        adminToken,
        "record-expense",
        {
          amountMinor: 45_000,
          branchCode: "DLA",
          categoryCode: "FUEL",
          assetId: dlaAssetId,
          expectStatus: "POSTED",
        },
      );

      const afterPosting = await fetchDashboard(adminToken);
      expect(afterPosting.openPeriod?.postedExpenseMinor).toBe(
        before.openPeriod!.postedExpenseMinor + 45_000,
      );

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

      // The original goes REVERSED and its mirror is POSTED with negated
      // lines: only summing both nets the pair back to zero.
      const afterReversal = await fetchDashboard(adminToken);
      expect(afterReversal.openPeriod?.postedExpenseMinor).toBe(
        before.openPeriod!.postedExpenseMinor,
      );
      expect(afterReversal.openPeriod?.postedRevenueMinor).toBe(
        before.openPeriod!.postedRevenueMinor,
      );
    });

    it("counts pending approvals with the same predicate as the approvals queue", async () => {
      for (const token of [adminToken, scopedToken, submitterToken]) {
        const [dashboard, queue] = await Promise.all([
          fetchDashboard(token),
          fetchApprovals(token),
        ]);
        expect(dashboard.pendingApprovals.count).toBe(queue.total);
        expect(dashboard.pendingApprovals.count).toBe(queue.entries.length);
      }
    });

    it("rejects an unauthenticated request", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/dashboard",
      });
      expect(response.statusCode).toBe(401);
    });
  });

  async function fetchDashboard(token: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return dashboardResponse.parse(response.json());
  }

  async function fetchApprovals(token: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/finance/approvals",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return pendingApprovalsResponse.parse(response.json());
  }

  async function registerAsset(
    token: string,
    assetCode: string,
    branchCode: string,
  ) {
    const assetId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `asset-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId,
          assetCode,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode,
        },
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `register-asset failed: ${response.statusCode} ${response.body}`,
      );
    }
    const body = response.json() as { rowVersion: number };
    return { assetId, rowVersion: body.rowVersion };
  }

  async function commissionAsset(
    token: string,
    asset: { assetId: string; rowVersion: number },
  ) {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/commission-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `commission-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: asset.rowVersion,
        },
        payload: { assetId: asset.assetId },
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `commission-asset failed: ${response.statusCode} ${response.body}`,
      );
    }
  }

  async function recordEntry(
    token: string,
    command: "record-expense" | "record-revenue",
    opts: {
      amountMinor: number;
      branchCode: string;
      categoryCode: string;
      assetId?: string;
      economicDate?: string;
      expectStatus: "POSTED" | "SUBMITTED";
    },
  ) {
    const entryId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${command}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `entry-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          entryId,
          branchCode: opts.branchCode,
          categoryCode: opts.categoryCode,
          economicDate: opts.economicDate ?? "2026-07-25",
          amountMinor: opts.amountMinor,
          paymentMethod: "CASH",
          postings: [
            opts.assetId === undefined
              ? { amountMinor: opts.amountMinor }
              : { assetId: opts.assetId, amountMinor: opts.amountMinor },
          ],
        },
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(`${command} failed: ${response.statusCode} ${response.body}`);
    }
    const body = response.json() as { recordStatus: string; rowVersion: number };
    expect(body.recordStatus).toBe(opts.expectStatus);
    return { entryId, rowVersion: body.rowVersion };
  }
});
