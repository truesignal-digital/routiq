import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  financialPostings,
  operationalIssues,
  workOrders,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

describe("work orders", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let submitterToken: string;
  let maintainerToken: string;
  let opsToken: string;
  let financeToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

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
    const ops = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    const finance = await seedMember(db, {
      workspaceId,
      role: "FINANCE_APPROVER",
      allBranches: true,
    });
    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    submitterToken = (
      await createSession(db, { principalId: submitter.principal.id, workspaceId })
    ).token;
    maintainerToken = (
      await createSession(db, { principalId: maintainer.principal.id, workspaceId })
    ).token;
    opsToken = (
      await createSession(db, { principalId: ops.principal.id, workspaceId })
    ).token;
    financeToken = (
      await createSession(db, { principalId: finance.principal.id, workspaceId })
    ).token;
    adminToken = (
      await createSession(db, { principalId: admin.principal.id, workspaceId })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("enters APPROVED below the band, numbered", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = randomUUID();
    const response = await postCommand(maintainerToken, "create-work-order", {
      workOrderId,
      assetId,
      description: "Replace front brake pads.",
      expectedCostMinor: 50_000,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: workOrderId,
      recordStatus: "APPROVED",
      rowVersion: 1,
    });

    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    expect(workOrder).toMatchObject({ status: "APPROVED" });
    expect(workOrder?.workOrderNumber).toMatch(/^DLA-\d{4}-\d{5}$/);
  });

  it("waits SUBMITTED above the band; maker cannot approve; a second decider can", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = randomUUID();
    const created = await postCommand(opsToken, "create-work-order", {
      workOrderId,
      assetId,
      description: "Engine overhaul.",
      expectedCostMinor: 250_000,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ recordStatus: "SUBMITTED" });

    const roleForbidden = await postCommand(
      maintainerToken,
      "approve-work-order",
      { workOrderId },
      { expectedVersion: 1 },
    );
    expect(roleForbidden.statusCode).toBe(403);
    expect(roleForbidden.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });

    const makerAttempt = await postCommand(
      opsToken,
      "approve-work-order",
      { workOrderId },
      { expectedVersion: 1 },
    );
    expect(makerAttempt.statusCode).toBe(403);
    expect(makerAttempt.json()).toMatchObject({
      error: { code: "MAKER_CANNOT_APPROVE" },
    });

    const approved = await postCommand(
      financeToken,
      "approve-work-order",
      { workOrderId, note: "Quote reviewed." },
      { expectedVersion: 1 },
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ recordStatus: "APPROVED", rowVersion: 2 });
  });

  it("rejection of a SUBMITTED work order is terminal", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = randomUUID();
    await postCommand(opsToken, "create-work-order", {
      workOrderId,
      assetId,
      description: "Full repaint.",
      expectedCostMinor: 500_000,
    });

    const rejected = await postCommand(
      financeToken,
      "reject-work-order",
      { workOrderId, reason: "Not this quarter." },
      { expectedVersion: 1 },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ recordStatus: "REJECTED" });

    const reapprove = await postCommand(
      financeToken,
      "approve-work-order",
      { workOrderId },
      { expectedVersion: 2 },
    );
    expect(reapprove.statusCode).toBe(409);
    expect(reapprove.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION", metadata: { from: "REJECTED" } },
    });
  });

  it("checks the linked issue: same asset, still OPEN", async () => {
    const assetA = await seedAsset(ctx.app, adminToken);
    const assetB = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId: assetA,
      categoryCode: "MECHANICAL",
    });

    const mismatch = await postCommand(maintainerToken, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: assetB,
      issueId,
      description: "Wrong truck.",
      expectedCostMinor: 10_000,
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toMatchObject({
      error: { code: "WORK_ORDER_ASSET_MISMATCH" },
    });

    await postCommand(
      opsToken,
      "dismiss-issue",
      { issueId, reason: "Reported in error." },
      { expectedVersion: 1 },
    );
    const closedIssue = await postCommand(maintainerToken, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: assetA,
      issueId,
      description: "Too late.",
      expectedCostMinor: 10_000,
    });
    expect(closedIssue.statusCode).toBe(409);
    expect(closedIssue.json()).toMatchObject({ error: { code: "ISSUE_NOT_OPEN" } });
  });

  it("costs attach while APPROVED only — with offline latitude", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = randomUUID();
    await postCommand(opsToken, "create-work-order", {
      workOrderId,
      assetId,
      description: "Gearbox rebuild.",
      expectedCostMinor: 300_000,
    });

    const live = await recordExpense(submitterToken, 40_000, {
      postings: [{ workOrderId, amountMinor: 40_000 }],
    });
    expect(live.response.statusCode).toBe(409);
    expect(live.response.json()).toMatchObject({
      error: { code: "WORK_ORDER_NOT_OPEN", metadata: { status: "SUBMITTED" } },
    });

    const replayed = await recordExpense(submitterToken, 40_000, {
      postings: [{ workOrderId, amountMinor: 40_000 }],
      origin: "OFFLINE_SYNC",
    });
    expect(replayed.response.statusCode).toBe(200);
    expect(replayed.response.json().warnings).toContain("WORK_ORDER_NOT_OPEN_AT_COMMIT");
  });

  it("a WO posting inherits the WO's asset and refuses a contradiction", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const otherAssetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = await createApprovedWorkOrder(assetId, 90_000);

    const filled = await recordExpense(maintainerToken, 30_000, {
      postings: [{ workOrderId, amountMinor: 30_000 }],
    });
    expect(filled.response.statusCode).toBe(200);

    const [posting] = await db
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, workspaceId),
          eq(financialPostings.financialEntryId, filled.entryId),
        ),
      );
    expect(posting).toMatchObject({ workOrderId, assetId, assetAttribution: "DIRECT" });

    const contradiction = await recordExpense(maintainerToken, 30_000, {
      postings: [{ workOrderId, assetId: otherAssetId, amountMinor: 30_000 }],
    });
    expect(contradiction.response.statusCode).toBe(422);
    expect(contradiction.response.json()).toMatchObject({
      error: { code: "WORK_ORDER_ASSET_MISMATCH" },
    });
  });

  it("completes below the band and resolves the linked issue in one transaction", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId,
      categoryCode: "BRAKES",
      safetyCritical: true,
    });
    const workOrderId = randomUUID();
    await postCommand(maintainerToken, "create-work-order", {
      workOrderId,
      assetId,
      issueId,
      description: "Brake pads.",
      expectedCostMinor: 80_000,
    });
    await recordExpense(maintainerToken, 60_000, {
      postings: [{ workOrderId, amountMinor: 60_000 }],
    });

    const completed = await postCommand(
      maintainerToken,
      "complete-work-order",
      { workOrderId, notes: "Pads replaced.", resolveLinkedIssue: true },
      { expectedVersion: 1 },
    );
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      recordStatus: "COMPLETED",
      rowVersion: 2,
      warnings: ["ISSUE_CLOSED_ASSET_STILL_UNAVAILABLE"],
    });

    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    expect(workOrder).toMatchObject({
      status: "COMPLETED",
      actualCostMinor: 60_000n,
      resolveLinkedIssue: true,
    });

    const [issue] = await db
      .select()
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(issue).toMatchObject({ status: "RESOLVED" });
  });

  it("gates completion on the actual total, holds the facts, applies them on approval", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId,
      categoryCode: "MECHANICAL",
    });
    const workOrderId = randomUUID();
    await postCommand(maintainerToken, "create-work-order", {
      workOrderId,
      assetId,
      issueId,
      description: "Suspension work.",
      expectedCostMinor: 80_000,
    });
    // Two in-band lines whose aggregate creeps over the 100k band.
    await recordExpense(submitterToken, 90_000, {
      postings: [{ workOrderId, amountMinor: 90_000 }],
    });
    await recordExpense(submitterToken, 90_000, {
      postings: [{ workOrderId, amountMinor: 90_000 }],
    });

    const submitted = await postCommand(
      opsToken,
      "complete-work-order",
      { workOrderId, resolveLinkedIssue: true },
      { expectedVersion: 1 },
    );
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({
      recordStatus: "COMPLETION_SUBMITTED",
      rowVersion: 2,
    });

    const [heldIssue] = await db
      .select({ status: operationalIssues.status })
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(heldIssue).toMatchObject({ status: "OPEN" });

    const makerAttempt = await postCommand(
      opsToken,
      "approve-work-order",
      { workOrderId },
      { expectedVersion: 2 },
    );
    expect(makerAttempt.statusCode).toBe(403);
    expect(makerAttempt.json()).toMatchObject({
      error: { code: "MAKER_CANNOT_APPROVE" },
    });

    const approved = await postCommand(
      adminToken,
      "approve-work-order",
      { workOrderId },
      { expectedVersion: 2 },
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ recordStatus: "COMPLETED", rowVersion: 3 });

    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    expect(workOrder).toMatchObject({ status: "COMPLETED", actualCostMinor: 180_000n });

    const [resolvedIssue] = await db
      .select({ status: operationalIssues.status })
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(resolvedIssue).toMatchObject({ status: "RESOLVED" });
  });

  it("completion rejection returns to APPROVED with the held facts nulled", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = await createApprovedWorkOrder(assetId, 80_000);
    await recordExpense(submitterToken, 95_000, {
      postings: [{ workOrderId, amountMinor: 95_000 }],
    });
    await recordExpense(submitterToken, 95_000, {
      postings: [{ workOrderId, amountMinor: 95_000 }],
    });

    const submitted = await postCommand(
      opsToken,
      "complete-work-order",
      { workOrderId, notes: "Done, pending sign-off." },
      { expectedVersion: 1 },
    );
    expect(submitted.json()).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });

    const rejected = await postCommand(
      adminToken,
      "reject-work-order",
      { workOrderId, reason: "Second invoice missing." },
      { expectedVersion: 2 },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ recordStatus: "APPROVED", rowVersion: 3 });

    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    expect(workOrder).toMatchObject({
      status: "APPROVED",
      completedAt: null,
      completionNotes: null,
      resolveLinkedIssue: null,
      actualCostMinor: null,
      completedByPrincipalId: null,
      rejectedReason: null,
    });

    // Work stays open: costs correctable, completion resubmittable.
    const resubmitted = await postCommand(
      opsToken,
      "complete-work-order",
      { workOrderId },
      { expectedVersion: 3 },
    );
    expect(resubmitted.statusCode).toBe(200);
    expect(resubmitted.json()).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
  });

  it("a reversal subtracts from the actual total through the mirrored attribution", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = await createApprovedWorkOrder(assetId, 90_000);
    const { entryId } = await recordExpense(submitterToken, 95_000, {
      postings: [{ workOrderId, amountMinor: 95_000 }],
    });
    await recordExpense(submitterToken, 95_000, {
      postings: [{ workOrderId, amountMinor: 95_000 }],
    });

    const reversalEntryId = randomUUID();
    const reversed = await postCommand(
      financeToken,
      "reverse-entry",
      { originalEntryId: entryId, reversalEntryId, reason: "Duplicate invoice." },
      { expectedVersion: 1 },
    );
    expect(reversed.statusCode).toBe(200);

    const [mirror] = await db
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, workspaceId),
          eq(financialPostings.financialEntryId, reversalEntryId),
        ),
      );
    expect(mirror).toMatchObject({ workOrderId, assetId, amountMinor: -95_000n });

    // 190k posted − 95k reversed = 95k actual: still below the band on net.
    const completed = await postCommand(
      opsToken,
      "complete-work-order",
      { workOrderId },
      { expectedVersion: 1 },
    );
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ recordStatus: "COMPLETED" });

    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    expect(workOrder).toMatchObject({ actualCostMinor: 95_000n });
  });

  it("cancellation from any non-terminal state warns when posted costs stand", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = await createApprovedWorkOrder(assetId, 90_000);
    await recordExpense(submitterToken, 45_000, {
      postings: [{ workOrderId, amountMinor: 45_000 }],
    });

    const cancelled = await postCommand(
      maintainerToken,
      "cancel-work-order",
      { workOrderId, reason: "Truck sold before the repair." },
      { expectedVersion: 1 },
    );
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      recordStatus: "CANCELLED",
      warnings: ["WORK_ORDER_CANCELLED_WITH_COSTS"],
    });

    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    expect(workOrder).toMatchObject({
      status: "CANCELLED",
      cancelledReason: "Truck sold before the repair.",
    });

    const complete = await postCommand(
      opsToken,
      "complete-work-order",
      { workOrderId },
      { expectedVersion: 2 },
    );
    expect(complete.statusCode).toBe(409);
    expect(complete.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION", metadata: { from: "CANCELLED" } },
    });
  });

  async function createApprovedWorkOrder(
    assetId: string,
    expectedCostMinor: number,
  ): Promise<string> {
    const workOrderId = randomUUID();
    const response = await postCommand(maintainerToken, "create-work-order", {
      workOrderId,
      assetId,
      description: "Scheduled maintenance.",
      expectedCostMinor,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordStatus: "APPROVED" });
    return workOrderId;
  }

  async function recordExpense(
    token: string,
    amountMinor: number,
    opts: {
      postings: Array<Record<string, unknown>>;
      origin?: "HUMAN_UI" | "OFFLINE_SYNC";
    },
  ) {
    const entryId = randomUUID();
    const response = await postCommand(
      token,
      "record-expense",
      {
        entryId,
        branchCode: "DLA",
        categoryCode: "REPAIRS",
        economicDate: `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
        amountMinor,
        paymentMethod: "MOMO",
        paymentReference: `MOMO-${randomUUID()}`,
        postings: opts.postings,
      },
      {},
      opts.origin ?? "HUMAN_UI",
    );
    return { entryId, response };
  }

  async function postCommand(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: { expectedVersion?: number } = {},
    origin: "HUMAN_UI" | "OFFLINE_SYNC" = "HUMAN_UI",
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
          origin,
          ...(envelope.expectedVersion === undefined
            ? {}
            : { expectedVersion: envelope.expectedVersion }),
        },
        payload,
      },
    });
  }
});
