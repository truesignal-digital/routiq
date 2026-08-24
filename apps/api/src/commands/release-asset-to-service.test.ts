import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { availabilityIntervals } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("release-asset-to-service", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let submitterToken: string;
  let maintainerToken: string;
  let opsToken: string;
  let admin2Token: string;
  let adminToken: string;
  let aiOpsToken: string;

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
    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const admin2 = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const aiOps = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      principalType: "AI_AGENT",
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
    adminToken = (
      await createSession(db, { principalId: admin.principal.id, workspaceId })
    ).token;
    admin2Token = (
      await createSession(db, { principalId: admin2.principal.id, workspaceId })
    ).token;
    aiOpsToken = (
      await createSession(db, { principalId: aiOps.principal.id, workspaceId })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("closes the open interval and warns while the opening issue is still OPEN", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    await postCommand(submitterToken, "report-issue", {
      issueId: randomUUID(),
      assetId,
      categoryCode: "BRAKES",
      safetyCritical: true,
    });

    const released = await postCommand(
      opsToken,
      "release-asset-to-service",
      { assetId, note: "Road-tested." },
      { expectedVersion: 1 },
    );
    expect(released.statusCode).toBe(200);
    expect(released.json()).toMatchObject({
      rowVersion: 2,
      warnings: ["ASSET_RELEASED_ISSUE_STILL_OPEN"],
    });

    const [interval] = await db
      .select()
      .from(availabilityIntervals)
      .where(
        and(
          eq(availabilityIntervals.workspaceId, workspaceId),
          eq(availabilityIntervals.assetId, assetId),
        ),
      );
    expect(interval?.endedAt).toBeInstanceOf(Date);
    expect(interval?.releaseNote).toBe("Road-tested.");
    expect(interval?.releasedByCommandId).not.toBeNull();

    const again = await postCommand(
      opsToken,
      "release-asset-to-service",
      { assetId },
      { expectedVersion: 2 },
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: "NO_OPEN_UNAVAILABILITY" } });
  });

  it("keeps the decision human and away from the performer on safety-critical work", async () => {
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
      description: "Brake job.",
      expectedCostMinor: 50_000,
    });
    // Ops submits the completion — ops is the performer on record.
    const completed = await postCommand(
      opsToken,
      "complete-work-order",
      { workOrderId, resolveLinkedIssue: true },
      { expectedVersion: 1 },
    );
    expect(completed.statusCode).toBe(200);

    const aiAttempt = await postCommand(
      aiOpsToken,
      "release-asset-to-service",
      { assetId },
      { expectedVersion: 1 },
    );
    expect(aiAttempt.statusCode).toBe(403);
    expect(aiAttempt.json()).toMatchObject({
      error: { code: "ROLE_FORBIDDEN", metadata: { reason: "HUMAN_PRINCIPAL_REQUIRED" } },
    });

    const maintainerAttempt = await postCommand(
      maintainerToken,
      "release-asset-to-service",
      { assetId },
      { expectedVersion: 1 },
    );
    expect(maintainerAttempt.statusCode).toBe(403);
    expect(maintainerAttempt.json()).toMatchObject({
      error: { code: "ROLE_FORBIDDEN" },
    });

    const performerAttempt = await postCommand(
      opsToken,
      "release-asset-to-service",
      { assetId },
      { expectedVersion: 1 },
    );
    expect(performerAttempt.statusCode).toBe(403);
    expect(performerAttempt.json()).toMatchObject({
      error: { code: "RELEASER_CANNOT_BE_PERFORMER" },
    });

    const released = await postCommand(
      admin2Token,
      "release-asset-to-service",
      { assetId, note: "Checked by a second pair of eyes." },
      { expectedVersion: 1 },
    );
    expect(released.statusCode).toBe(200);
    expect(released.json()).toMatchObject({ warnings: [] });
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
