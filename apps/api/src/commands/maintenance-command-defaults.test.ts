import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { approvalRules } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { corePack } from "../provisioning/packs/core.js";

const MAINTENANCE_COMMANDS = [
  "report-issue",
  "create-work-order",
  "approve-work-order",
  "complete-work-order",
  "approve-work-order-closure",
  "cancel-work-order",
  "release-asset-to-service",
] as const;

const BACKFILL = fileURLToPath(
  new URL("../../drizzle/0026_maintenance_command_defaults.sql", import.meta.url),
);

/**
 * The core pack only runs when a workspace is created, so every tenant that
 * predates the maintenance commands would meet them with no matching approval
 * rule — and no matching rule means APPROVAL_REQUIRED, which the dispatcher
 * turns into 403 on the commands that reject and into a permanently pending
 * record on the two that submit. That is what migration 0026 exists to prevent,
 * and these tests run the shipped SQL rather than a copy of it.
 */
describe("maintenance command approval defaults", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let backfillSql: string;

  beforeAll(async () => {
    ctx = await createTestApp({ isolated: true });
    backfillSql = await readFile(BACKFILL, "utf8");
  });

  afterAll(async () => {
    await ctx.close();
  });

  function maintenanceRulesOf(workspaceId: string) {
    return ctx.db
      .select({
        commandType: approvalRules.commandType,
        requiredRole: approvalRules.requiredRole,
      })
      .from(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          inArray(approvalRules.commandType, [...MAINTENANCE_COMMANDS]),
        ),
      );
  }

  /** A workspace as it looked before this branch: the maintenance rules stripped out. */
  async function seedPreUpgradeWorkspace() {
    const seeded = await seedWorkspace(
      ctx.db,
      `ws-maint-backfill-${randomUUID().slice(0, 8)}`,
    );
    await ctx.db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          inArray(approvalRules.commandType, [...MAINTENANCE_COMMANDS]),
        ),
      );
    return seeded;
  }

  /**
   * The backfill and the core pack are two copies of one decision, and the only
   * thing keeping them honest is a test that reads both.
   */
  it("gives an existing workspace exactly the rules a new one is provisioned with", async () => {
    const seeded = await seedPreUpgradeWorkspace();
    expect(await maintenanceRulesOf(seeded.workspace.id)).toHaveLength(0);

    await ctx.db.execute(sql.raw(backfillSql));

    const backfilled = (await maintenanceRulesOf(seeded.workspace.id))
      .map((rule) => `${rule.commandType}:${rule.requiredRole}`)
      .sort();
    const provisioned = corePack.approvalRules
      .filter((rule) =>
        (MAINTENANCE_COMMANDS as readonly string[]).includes(rule.commandType),
      )
      .map((rule) => `${rule.commandType}:${rule.requiredRole}`)
      .sort();

    expect(backfilled).toEqual(provisioned);
    // The two decisions specifically: without these rows an approver on a live
    // tenant meets 403 and the pending work order can never be resolved.
    expect(backfilled).toContain("approve-work-order:FINANCE_APPROVER");
    expect(backfilled).toContain("approve-work-order:ADMIN");
    expect(backfilled).toContain("approve-work-order-closure:FINANCE_APPROVER");
    expect(backfilled).toContain("approve-work-order-closure:ADMIN");
  });

  it("adds nothing on a second run", async () => {
    const seeded = await seedPreUpgradeWorkspace();
    await ctx.db.execute(sql.raw(backfillSql));
    const afterFirst = await maintenanceRulesOf(seeded.workspace.id);

    await ctx.db.execute(sql.raw(backfillSql));
    expect(await maintenanceRulesOf(seeded.workspace.id)).toHaveLength(
      afterFirst.length,
    );
  });

  /** The behaviour the backfill exists to restore, end to end. */
  it("lets a backfilled workspace resolve a pending work order instead of 403", async () => {
    const seeded = await seedPreUpgradeWorkspace();
    const workspaceId = seeded.workspace.id;
    await ctx.db.execute(sql.raw(backfillSql));

    const admin = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const adminToken = (
      await createSession(ctx.db, {
        workspaceId,
        principalId: admin.principal.id,
      })
    ).token;
    const approver = await seedMember(ctx.db, {
      workspaceId,
      role: "FINANCE_APPROVER",
      allBranches: true,
    });
    const approverToken = (
      await createSession(ctx.db, {
        workspaceId,
        principalId: approver.principal.id,
      })
    ).token;

    // A threshold rule the admin cannot clear alone, so creation lands pending.
    await ctx.db.insert(approvalRules).values({
      workspaceId,
      commandType: "create-work-order",
      categoryCode: null,
      branchId: null,
      amountMinMinor: 100_000n,
      amountMaxMinor: null,
      requiredRole: "FINANCE_APPROVER",
      createdByCommandId: null,
    });

    const assetId = await seedAsset(ctx.app, adminToken);
    const workOrderId = randomUUID();
    const created = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/create-work-order",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          workOrderId,
          assetId,
          description: "Après migration",
          expectedCostMinor: 400_000,
        },
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ recordStatus: "SUBMITTED" });

    const approved = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/approve-work-order",
      headers: { authorization: `Bearer ${approverToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: 1,
        },
        payload: { workOrderId },
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ recordStatus: "APPROVED" });
  });
});
