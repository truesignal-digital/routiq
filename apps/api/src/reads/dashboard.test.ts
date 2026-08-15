import { randomUUID } from "node:crypto";
import {
  DASHBOARD_SERIES_DAYS_DEFAULT,
  dashboardResponse,
  pendingApprovalsResponse,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { addDays, currentBusinessDate } from "./business-date.js";

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

      expect(body.assets).toEqual({
        total: 0,
        byStatus: {
          REGISTERED: 0,
          IN_SERVICE: 0,
          UNDER_MAINTENANCE: 0,
          SOLD: 0,
          RETIRED: 0,
          WRITTEN_OFF: 0,
        },
      });
      expect(body.openPeriod).toBeNull();
      expect(body.pendingApprovals).toEqual({ count: 0, outsideBranchCount: 0 });
      // A workspace with nothing posted still gets a full window of explicit
      // zeros — an empty array would leave the chart with nothing to draw.
      expect(body.series).toHaveLength(DASHBOARD_SERIES_DAYS_DEFAULT);
      expect(
        body.series.every((p) => p.expenseMinor === 0 && p.revenueMinor === 0),
      ).toBe(true);
    });
  });

  describe("populated workspace", () => {
    /** Two branches, so branch scope has something to narrow. */
    let adminToken: string;
    let scopedToken: string;
    let submitterToken: string;
    let dlaAssetId: string;
    let dlaBranchId: string;
    let ydeBranchId: string;

    beforeAll(async () => {
      const seeded = await seedWorkspace(db);
      const workspaceId = seeded.workspace.id;
      dlaBranchId = seeded.branch.id;

      const [yde] = await db
        .insert(branches)
        .values({ workspaceId, code: "YDE", name: "Yaoundé" })
        .returning();
      if (!yde) throw new Error("branch insert returned no row");
      ydeBranchId = yde.id;

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

    it("narrows every count to the branch the client asked for", async () => {
      const body = await fetchDashboard(adminToken, undefined, dlaBranchId);

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
      expect(body.openPeriod).toMatchObject({
        postedExpenseMinor: 50_000,
        postedRevenueMinor: 200_000,
      });
      expect(body.pendingApprovals.count).toBe(1);
    });

    it("narrows within branch scope and never widens past it", async () => {
      // The member is scoped to DLA and asks for YDE: the answer is an empty
      // dashboard, not YDE's numbers (ADR-0003).
      const body = await fetchDashboard(scopedToken, undefined, ydeBranchId);

      expect(body.assets.total).toBe(0);
      expect(body.openPeriod).toMatchObject({
        postedExpenseMinor: 0,
        postedRevenueMinor: 0,
      });
      expect(body.pendingApprovals.count).toBe(0);
    });

    it("reports the pending work the branch narrowing is hiding", async () => {
      const body = await fetchDashboard(adminToken, undefined, dlaBranchId);

      // YDE's submission never reaches the card's count; the overflow is the
      // only thing that says it exists.
      expect(body.pendingApprovals.count).toBe(1);
      expect(body.pendingApprovals.outsideBranchCount).toBe(1);
    });

    it("reports no overflow without a branch narrowing", async () => {
      const body = await fetchDashboard(adminToken);

      expect(body.pendingApprovals.outsideBranchCount).toBe(0);
    });

    it("counts the overflow inside the caller's branch scope only", async () => {
      const body = await fetchDashboard(scopedToken, undefined, dlaBranchId);

      // Scoped to DLA: YDE's submission is not work this member can widen to.
      expect(body.pendingApprovals.count).toBe(1);
      expect(body.pendingApprovals.outsideBranchCount).toBe(0);
    });

    it("rejects a branchId that is not a uuid with VALIDATION_FAILED", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/dashboard?branchId=DLA",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
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

    it("agrees with the queue on the overflow a branch narrowing hides", async () => {
      for (const token of [adminToken, scopedToken, submitterToken]) {
        const [dashboard, queue] = await Promise.all([
          fetchDashboard(token, undefined, dlaBranchId),
          fetchApprovals(token, dlaBranchId),
        ]);
        expect(dashboard.pendingApprovals.outsideBranchCount).toBe(
          queue.outsideBranchCount,
        );
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

  describe("posted totals time series", () => {
    /**
     * Dates are derived from one captured business day, never hard-coded: the
     * window is relative to the server's today, so a fixture pinned to a
     * calendar date would silently slide out of the window as time passes.
     */
    let today: string;
    let adminToken: string;
    let scopedToken: string;
    let dlaBranchId: string;

    beforeAll(async () => {
      const seeded = await seedWorkspace(db);
      const workspaceId = seeded.workspace.id;
      dlaBranchId = seeded.branch.id;
      await db
        .insert(branches)
        .values({ workspaceId, code: "YDE", name: "Yaoundé" });

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

      today = currentBusinessDate(new Date(), "Africa/Douala");

      await recordEntry(adminToken, "record-expense", {
        amountMinor: 50_000,
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: today,
        expectStatus: "POSTED",
      });
      await recordEntry(adminToken, "record-expense", {
        amountMinor: 30_000,
        branchCode: "YDE",
        categoryCode: "FUEL",
        economicDate: addDays(today, -2),
        expectStatus: "POSTED",
      });
      await recordEntry(adminToken, "record-revenue", {
        amountMinor: 200_000,
        branchCode: "DLA",
        categoryCode: "FREIGHT_REVENUE",
        economicDate: addDays(today, -3),
        expectStatus: "POSTED",
      });
      // Older than any window the client can ask for except the widest.
      await recordEntry(adminToken, "record-expense", {
        amountMinor: 70_000,
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: addDays(today, -120),
        expectStatus: "POSTED",
      });
    });

    it("buckets each day on its economic date", async () => {
      const { series } = await fetchDashboard(adminToken);

      expect(dayOf(series, today)).toEqual({
        date: today,
        expenseMinor: 50_000,
        revenueMinor: 0,
      });
      expect(dayOf(series, addDays(today, -2))).toMatchObject({
        expenseMinor: 30_000,
        revenueMinor: 0,
      });
      expect(dayOf(series, addDays(today, -3))).toMatchObject({
        expenseMinor: 0,
        revenueMinor: 200_000,
      });
    });

    it("zero-fills a day nothing was posted on", async () => {
      const { series } = await fetchDashboard(adminToken);

      expect(dayOf(series, addDays(today, -5))).toEqual({
        date: addDays(today, -5),
        expenseMinor: 0,
        revenueMinor: 0,
      });
    });

    it("returns every day of the requested window, ascending and contiguous", async () => {
      for (const days of [DASHBOARD_SERIES_DAYS_DEFAULT, 30, 7]) {
        const { series } = await fetchDashboard(adminToken, days);

        expect(series).toHaveLength(days);
        expect(series.at(-1)?.date).toBe(today);
        expect(series[0]?.date).toBe(addDays(today, -(days - 1)));
        expect(series.map((p) => p.date)).toEqual(
          series.map((_, i) => addDays(today, i - days + 1)),
        );
      }
    });

    it("defaults the window to 90 days when the client asks for none", async () => {
      const { series } = await fetchDashboard(adminToken);
      expect(series).toHaveLength(90);
    });

    it("leaves out days before the window and keeps them in a wider one", async () => {
      const old = addDays(today, -120);

      const narrow = await fetchDashboard(adminToken, 90);
      expect(dayOf(narrow.series, old)).toBeUndefined();

      const wide = await fetchDashboard(adminToken, 365);
      expect(dayOf(wide.series, old)).toMatchObject({ expenseMinor: 70_000 });
    });

    it("nets a reversal back to zero on the day it was economically dated", async () => {
      const reversedDay = addDays(today, -1);
      const { entryId, rowVersion } = await recordEntry(
        adminToken,
        "record-expense",
        {
          amountMinor: 45_000,
          branchCode: "DLA",
          categoryCode: "FUEL",
          economicDate: reversedDay,
          expectStatus: "POSTED",
        },
      );

      const posted = await fetchDashboard(adminToken);
      expect(dayOf(posted.series, reversedDay)).toMatchObject({
        expenseMinor: 45_000,
      });

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

      // The reversal inherits the original's economic date, so the pair nets on
      // that day — not on the day the correction happened to be captured.
      const reversed = await fetchDashboard(adminToken);
      expect(dayOf(reversed.series, reversedDay)).toEqual({
        date: reversedDay,
        expenseMinor: 0,
        revenueMinor: 0,
      });
    });

    it("narrows the series to a branch-scoped member's branches", async () => {
      const { series } = await fetchDashboard(scopedToken);

      expect(dayOf(series, today)).toMatchObject({ expenseMinor: 50_000 });
      // YDE's 30_000 is out of scope, and its day still arrives as a zero.
      expect(dayOf(series, addDays(today, -2))).toEqual({
        date: addDays(today, -2),
        expenseMinor: 0,
        revenueMinor: 0,
      });
    });

    it("narrows the series to the branch the client asked for", async () => {
      const { series } = await fetchDashboard(adminToken, undefined, dlaBranchId);

      expect(dayOf(series, today)).toMatchObject({ expenseMinor: 50_000 });
      // YDE's 30_000 is filtered out, and its day is still a zero, not a gap.
      expect(dayOf(series, addDays(today, -2))).toEqual({
        date: addDays(today, -2),
        expenseMinor: 0,
        revenueMinor: 0,
      });
    });

    it.each([6, 366, 0, -30, "ninety"])(
      "rejects days=%s with VALIDATION_FAILED",
      async (days) => {
        const response = await ctx.app.inject({
          method: "GET",
          url: `/v1/dashboard?days=${days}`,
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: { code: "VALIDATION_FAILED" },
        });
      },
    );
  });

  function dayOf<TPoint extends { date: string }>(
    series: readonly TPoint[],
    date: string,
  ): TPoint | undefined {
    return series.find((point) => point.date === date);
  }

  async function fetchDashboard(
    token: string,
    days?: number | string,
    branchId?: string,
  ) {
    const query = new URLSearchParams();
    if (days !== undefined) query.append("days", String(days));
    if (branchId !== undefined) query.append("branchId", branchId);
    const search = query.toString();
    const response = await ctx.app.inject({
      method: "GET",
      url: search === "" ? "/v1/dashboard" : `/v1/dashboard?${search}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return dashboardResponse.parse(response.json());
  }

  async function fetchApprovals(token: string, branchId?: string) {
    const search = branchId === undefined ? "" : `?branchId=${branchId}`;
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/finance/approvals${search}`,
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
