import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  assetAvailabilityIntervals,
  assets,
  operationalIssues,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * Signalement capture, and the one decision it makes on its own: a
 * safety-critical report grounds the asset immediately.
 */
describe("report-issue.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let driverToken: string;
  let otherWorkspaceAssetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(db, { workspaceId, principalId: admin.principal.id })
    ).token;

    const driver = await seedMember(db, {
      workspaceId,
      role: "DRIVER",
      allBranches: true,
    });
    driverToken = (
      await createSession(db, { workspaceId, principalId: driver.principal.id })
    ).token;

    const otherSeeded = await seedWorkspace(db);
    const otherAdmin = await seedMember(db, {
      workspaceId: otherSeeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const otherToken = (
      await createSession(db, {
        workspaceId: otherSeeded.workspace.id,
        principalId: otherAdmin.principal.id,
      })
    ).token;
    otherWorkspaceAssetId = await seedAsset(ctx.app, otherToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function report(
    token: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/report-issue",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "report-issue",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...envelope,
        },
        payload,
      },
    });
  }

  function openIntervals(assetId: string) {
    return db
      .select()
      .from(assetAvailabilityIntervals)
      .where(
        and(
          eq(assetAvailabilityIntervals.assetId, assetId),
          isNull(assetAvailabilityIntervals.closedAt),
        ),
      );
  }

  it("records a non-safety-critical signalement without grounding the truck", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();

    const response = await report(driverToken, {
      issueId,
      assetId,
      description: "Rétroviseur droit fissuré",
      safetyCritical: false,
      category: "BODYWORK",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: issueId,
      rowVersion: 1,
      warnings: [],
      idempotentReplay: false,
    });

    const [issue] = await db
      .select()
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(issue).toMatchObject({
      workspaceId,
      assetId,
      safetyCritical: false,
      category: "BODYWORK",
    });

    expect(await openIntervals(assetId)).toHaveLength(0);
  });

  it("grounds the asset on a safety-critical signalement", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();

    expect(
      (
        await report(driverToken, {
          issueId,
          assetId,
          description: "Fuite sur le circuit de freinage",
          safetyCritical: true,
        })
      ).statusCode,
    ).toBe(200);

    const intervals = await openIntervals(assetId);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({
      workspaceId,
      assetId,
      openedByIssueId: issueId,
      closedAt: null,
      closedByCommandId: null,
      rowVersion: 1,
    });
  });

  /**
   * The truck cannot be more grounded than it already is. Two open intervals
   * would need two releases to undo one grounding.
   */
  it("opens no second interval when the asset is already down", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const firstIssueId = randomUUID();
    const secondIssueId = randomUUID();

    expect(
      (
        await report(driverToken, {
          issueId: firstIssueId,
          assetId,
          description: "Fuite de liquide de frein",
          safetyCritical: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await report(driverToken, {
          issueId: secondIssueId,
          assetId,
          description: "Pneu avant gauche lisse",
          safetyCritical: true,
        })
      ).statusCode,
    ).toBe(200);

    const intervals = await openIntervals(assetId);
    expect(intervals).toHaveLength(1);
    // The interval still names the report that grounded the truck, not the one
    // that found it already grounded.
    expect(intervals[0]?.openedByIssueId).toBe(firstIssueId);

    const issues = await db
      .select()
      .from(operationalIssues)
      .where(eq(operationalIssues.assetId, assetId));
    expect(issues).toHaveLength(2);
  });

  it("dates the report when the driver wrote it, not when the phone found signal", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();

    expect(
      (
        await report(
          driverToken,
          {
            issueId,
            assetId,
            description: "Embrayage qui patine",
            safetyCritical: false,
          },
          {
            origin: "OFFLINE_SYNC",
            clientOccurredAt: "2026-08-11T06:30:00Z",
          },
        )
      ).statusCode,
    ).toBe(200);

    const [issue] = await db
      .select()
      .from(operationalIssues)
      .where(eq(operationalIssues.id, issueId));
    expect(issue?.reportedAt).toEqual(new Date("2026-08-11T06:30:00Z"));
  });

  it("cannot report against another workspace's asset", async () => {
    const response = await report(adminToken, {
      issueId: randomUUID(),
      assetId: otherWorkspaceAssetId,
      description: "Signalement croisé",
      safetyCritical: true,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "asset" } },
    });

    expect(await openIntervals(otherWorkspaceAssetId)).toHaveLength(0);
  });

  it("refuses a signalement on a disposed asset", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    await db
      .update(assets)
      .set({ lifecycleStatus: "SOLD" })
      .where(eq(assets.id, assetId));

    const response = await report(driverToken, {
      issueId: randomUUID(),
      assetId,
      description: "Panne sur un camion vendu",
      safetyCritical: true,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "ASSET_NOT_OPERATIONAL" },
    });
  });

  it("replays an identical retry rather than recording the signalement twice", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    const envelope = {
      commandId: randomUUID(),
      idempotencyKey: `idem-${randomUUID()}`,
    };
    const payload = {
      issueId,
      assetId,
      description: "Direction dure",
      safetyCritical: true,
    };

    expect((await report(driverToken, payload, envelope)).statusCode).toBe(200);
    const replay = await report(driverToken, payload, envelope);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotentReplay: true });

    expect(await openIntervals(assetId)).toHaveLength(1);
  });
});
