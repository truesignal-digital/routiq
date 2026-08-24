import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  auditEvents,
  availabilityIntervals,
  operationalIssues,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("operational issues", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let submitterToken: string;
  let opsToken: string;
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
    const ops = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
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
    opsToken = (
      await createSession(db, { principalId: ops.principal.id, workspaceId })
    ).token;
    adminToken = (
      await createSession(db, { principalId: admin.principal.id, workspaceId })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("captures a non-critical report without touching availability", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    const response = await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId,
      categoryCode: "TIRES",
      description: "Slow leak, front left.",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: issueId,
      recordStatus: "OPEN",
      rowVersion: 1,
      warnings: [],
    });

    const [issue] = await db
      .select()
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(issue).toMatchObject({ status: "OPEN", safetyCritical: false });
    expect(issue?.issueNumber).toMatch(/^DLA-\d{4}-\d{5}$/);

    const intervals = await db
      .select()
      .from(availabilityIntervals)
      .where(
        and(
          eq(availabilityIntervals.workspaceId, workspaceId),
          eq(availabilityIntervals.assetId, assetId),
        ),
      );
    expect(intervals).toHaveLength(0);
  });

  it("safety-critical report opens the downtime interval in the same transaction", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    const reportedAt = "2026-08-20T07:30:00+01:00";
    const response = await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId,
      categoryCode: "BRAKES",
      safetyCritical: true,
      reportedAt,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ warnings: [] });

    const [interval] = await db
      .select()
      .from(availabilityIntervals)
      .where(
        and(
          eq(availabilityIntervals.workspaceId, workspaceId),
          eq(availabilityIntervals.assetId, assetId),
        ),
      );
    expect(interval).toMatchObject({
      reason: "SAFETY_CRITICAL_ISSUE",
      openedByIssueId: issueId,
      endedAt: null,
    });
    expect(interval?.startedAt.toISOString()).toBe("2026-08-20T06:30:00.000Z");

    const audits = await db
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          eq(auditEvents.entityType, "availability_interval"),
          eq(auditEvents.entityId, interval!.id),
        ),
      );
    expect(audits.map((a) => a.eventType)).toContain("availability_interval.opened");
  });

  it("a second safety-critical report warns instead of stacking intervals", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const first = await postCommand(submitterToken, "report-issue", {
      issueId: randomUUID(),
      assetId,
      categoryCode: "BRAKES",
      safetyCritical: true,
    });
    expect(first.statusCode).toBe(200);

    const second = await postCommand(submitterToken, "report-issue", {
      issueId: randomUUID(),
      assetId,
      categoryCode: "ACCIDENT",
      safetyCritical: true,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ warnings: ["ASSET_ALREADY_UNAVAILABLE"] });

    const intervals = await db
      .select()
      .from(availabilityIntervals)
      .where(
        and(
          eq(availabilityIntervals.workspaceId, workspaceId),
          eq(availabilityIntervals.assetId, assetId),
        ),
      );
    expect(intervals).toHaveLength(1);
  });

  it("resolve closes the issue but leaves the interval, warning about it", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId,
      categoryCode: "BRAKES",
      safetyCritical: true,
    });

    const resolved = await postCommand(
      submitterToken,
      "resolve-issue",
      { issueId, note: "Pads replaced on the spot." },
      { expectedVersion: 1 },
    );
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      recordStatus: "RESOLVED",
      rowVersion: 2,
      warnings: ["ISSUE_CLOSED_ASSET_STILL_UNAVAILABLE"],
    });

    const [issue] = await db
      .select()
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(issue).toMatchObject({ status: "RESOLVED", resolutionNote: "Pads replaced on the spot." });
    expect(issue?.resolvedAt).toBeInstanceOf(Date);

    const again = await postCommand(
      submitterToken,
      "resolve-issue",
      { issueId },
      { expectedVersion: 2 },
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION", metadata: { from: "RESOLVED" } },
    });
  });

  it("dismissal records the reason and is kept from field submitters", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    await postCommand(submitterToken, "report-issue", {
      issueId,
      assetId,
      categoryCode: "OTHER",
    });

    const forbidden = await postCommand(
      submitterToken,
      "dismiss-issue",
      { issueId, reason: "oops" },
      { expectedVersion: 1 },
    );
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });

    const dismissed = await postCommand(
      opsToken,
      "dismiss-issue",
      { issueId, reason: "Duplicate of an earlier report." },
      { expectedVersion: 1 },
    );
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json()).toMatchObject({ recordStatus: "DISMISSED", warnings: [] });

    const [issue] = await db
      .select()
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(issue).toMatchObject({
      status: "DISMISSED",
      dismissedReason: "Duplicate of an earlier report.",
    });
  });

  it("refuses a category of the wrong kind", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const response = await postCommand(submitterToken, "report-issue", {
      issueId: randomUUID(),
      assetId,
      categoryCode: "FUEL",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "CATEGORY_KIND_MISMATCH", metadata: { expectedKind: "ISSUE_TYPE" } },
    });
  });

  it("is gated on the MAINTENANCE module", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const disable = await postCommand(adminToken, "disable-module", {
      moduleCode: "MAINTENANCE",
    });
    expect(disable.statusCode).toBe(200);

    const refused = await postCommand(submitterToken, "report-issue", {
      issueId: randomUUID(),
      assetId,
      categoryCode: "TIRES",
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: "MODULE_DISABLED" } });

    const enable = await postCommand(adminToken, "enable-module", {
      moduleCode: "MAINTENANCE",
    });
    expect(enable.statusCode).toBe(200);
  });

  async function postCommand(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: { expectedVersion?: number } = {},
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
          ...(envelope.expectedVersion === undefined
            ? {}
            : { expectedVersion: envelope.expectedVersion }),
        },
        payload,
      },
    });
  }
});
