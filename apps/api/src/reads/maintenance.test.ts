import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { branches } from "../db/schema.js";
import { currentPeriodCode } from "../commands/periods.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("maintenance reads", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let dlaBranchId: string;
  let submitterToken: string;
  let maintainerToken: string;
  let adminToken: string;
  let scopedToken: string;
  let assetId: string;
  let issueId: string;
  let workOrderId: string;
  let expenseEntryId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    dlaBranchId = seeded.branch.id;
    const [yde] = await db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();

    const submitter = await seedMember(db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      allBranches: true,
    });
    const maintainer = await seedMember(db, {
      workspaceId,
      role: "MAINTENANCE",
      allBranches: true,
    });
    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    // Scoped to the OTHER branch: must see none of the DLA rows below.
    const scoped = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      branchIds: [yde!.id],
    });
    submitterToken = (
      await createSession(db, { principalId: submitter.principal.id, workspaceId })
    ).token;
    maintainerToken = (
      await createSession(db, { principalId: maintainer.principal.id, workspaceId })
    ).token;
    adminToken = (
      await createSession(db, { principalId: admin.principal.id, workspaceId })
    ).token;
    scopedToken = (
      await createSession(db, { principalId: scoped.principal.id, workspaceId })
    ).token;

    assetId = await seedAsset(ctx.app, adminToken);
    issueId = randomUUID();
    await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId,
      categoryCode: "BRAKES",
      description: "Grinding on braking.",
      safetyCritical: true,
    });
    workOrderId = randomUUID();
    await postCommand(maintainerToken, "create-work-order", {
      workOrderId,
      assetId,
      issueId,
      description: "Brake pads and discs.",
      expectedCostMinor: 90_000,
    });
    expenseEntryId = randomUUID();
    const expense = await postCommand(submitterToken, "record-expense", {
      entryId: expenseEntryId,
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate: `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
      amountMinor: 60_000,
      paymentMethod: "MOMO",
      paymentReference: `MOMO-${randomUUID()}`,
      postings: [{ workOrderId, amountMinor: 60_000 }],
    });
    expect(expense.statusCode).toBe(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("lists issues with category, downtime state and work-order count", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/maintenance/issues?status=OPEN&safetyCritical=true",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const item = body.items.find((candidate: { id: string }) => candidate.id === issueId);
    expect(item).toMatchObject({
      category: { code: "BRAKES", labelFr: "Freins" },
      assetId,
      branchId: dlaBranchId,
      safetyCritical: true,
      status: "OPEN",
      workOrderCount: 1,
      assetUnavailable: true,
      rowVersion: 1,
    });
    expect(item.issueNumber).toMatch(/^DLA-\d{4}-\d{5}$/);
  });

  it("lists work orders with the live posted cost", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/maintenance/work-orders?assetId=${assetId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const item = response
      .json()
      .items.find((candidate: { id: string }) => candidate.id === workOrderId);
    expect(item).toMatchObject({
      status: "APPROVED",
      operationalIssueId: issueId,
      expectedCostMinor: 90_000,
      postedCostMinor: 60_000,
      currency: "XAF",
    });
  });

  it("serves the work-order detail with its issue and cost entries", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/maintenance/work-orders/${workOrderId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const detail = response.json();
    expect(detail).toMatchObject({
      workOrderNumber: expect.stringMatching(/^DLA-\d{4}-\d{5}$/),
      branchCode: "DLA",
      status: "APPROVED",
      postedCostMinor: 60_000,
      actualCostMinor: null,
      assetUnavailable: true,
      issue: {
        id: issueId,
        status: "OPEN",
        safetyCritical: true,
      },
    });
    expect(detail.costEntries).toHaveLength(1);
    expect(detail.costEntries[0]).toMatchObject({
      entryId: expenseEntryId,
      categoryCode: "REPAIRS",
      amountMinor: 60_000,
      status: "POSTED",
    });
  });

  it("branch scope hides other branches' maintenance work entirely", async () => {
    const list = await ctx.app.inject({
      method: "GET",
      url: "/v1/maintenance/issues",
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(0);

    const detail = await ctx.app.inject({
      method: "GET",
      url: `/v1/maintenance/work-orders/${workOrderId}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(detail.statusCode).toBe(404);
  });

  it("rejects an unsortable field and a tampered cursor", async () => {
    const badSort = await ctx.app.inject({
      method: "GET",
      url: "/v1/maintenance/issues?sort=description:asc",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(badSort.statusCode).toBe(400);

    const badCursor = await ctx.app.inject({
      method: "GET",
      url: "/v1/maintenance/work-orders?cursor=not-a-cursor",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(badCursor.statusCode).toBe(400);
  });

  async function postCommand(
    token: string,
    name: string,
    payload: Record<string, unknown>,
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }
});
