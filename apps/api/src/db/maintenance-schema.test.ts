import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  operationalIssues,
  workOrders,
  assetAvailabilityIntervals,
  commands,
} from "./schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/**
 * Structural guarantees for maintenance tables (operational_issues, work_orders,
 * asset_availability_intervals), asserted against the database rather than
 * through handlers — the point is that they survive a bug in, or a bypass of,
 * the command layer.
 */
async function pgErrorCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    return wrapped.cause?.code ?? wrapped.code;
  }
}

describe("maintenance schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let branchId: string;
  let otherBranchId: string;
  let assetId: string;
  let otherAssetId: string;
  let commandId: string;
  let otherCommandId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    const otherSeeded = await seedWorkspace(ctx.db);
    otherWorkspaceId = otherSeeded.workspace.id;
    otherBranchId = otherSeeded.branch.id;

    const { principal } = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });

    const { principal: otherPrincipal } = await seedMember(ctx.db, {
      workspaceId: otherWorkspaceId,
      role: "ADMIN",
      allBranches: true,
    });

    commandId = randomUUID();
    await ctx.db.insert(commands).values({
      id: commandId,
      workspaceId,
      commandType: "schema-test",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: principal.id,
      idempotencyKey: `idem-${randomUUID()}`,
      payload: {},
    });

    otherCommandId = randomUUID();
    await ctx.db.insert(commands).values({
      id: otherCommandId,
      workspaceId: otherWorkspaceId,
      commandType: "schema-test",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: otherPrincipal.id,
      idempotencyKey: `idem-${randomUUID()}`,
      payload: {},
    });

    const assetRows = await ctx.db.execute(sql`
      insert into assets (id, workspace_id, branch_id, asset_code, asset_class_code,
                          template_code, created_by_command_id)
      values (gen_random_uuid(), ${workspaceId}, ${branchId}, 'SCHEMA-MAINT-A', 'TRUCK',
              'TRUCKING', ${commandId}),
             (gen_random_uuid(), ${otherWorkspaceId}, ${otherBranchId}, 'SCHEMA-MAINT-B', 'TRUCK',
              'TRUCKING', ${otherCommandId})
      returning id
    `);
    const ids = (assetRows.rows as { id: string }[]).map((row) => row.id);
    assetId = ids[0]!;
    otherAssetId = ids[1]!;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("operational_issues: created_by_command_id tenant FK", () => {
    it("accepts a command from the same workspace", async () => {
      await expect(
        ctx.db.insert(operationalIssues).values({
          id: randomUUID(),
          workspaceId,
          assetId,
          description: "Test issue",
          safetyCritical: true,
          reportedAt: new Date(),
          createdByCommandId: commandId,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a command from another workspace", async () => {
      expect(
        await pgErrorCode(
          ctx.db.insert(operationalIssues).values({
            id: randomUUID(),
            workspaceId: otherWorkspaceId,
            assetId: otherAssetId,
            description: "Cross-workspace issue",
            safetyCritical: false,
            reportedAt: new Date(),
            createdByCommandId: commandId,
          }),
        ),
      ).toBe("23503");
    });
  });

  describe("work_orders: composite tenant FKs", () => {
    let issueId: string;

    beforeAll(async () => {
      issueId = randomUUID();
      await ctx.db.insert(operationalIssues).values({
        id: issueId,
        workspaceId,
        assetId,
        description: "Issue for work order test",
        safetyCritical: false,
        reportedAt: new Date(),
        createdByCommandId: commandId,
      });
    });

    it("accepts a work order linked to an issue in the same workspace and asset", async () => {
      await expect(
        ctx.db.insert(workOrders).values({
          id: randomUUID(),
          workspaceId,
          assetId,
          issueId,
          description: "Repair work",
          createdByCommandId: commandId,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a work order using an asset from another workspace", async () => {
      expect(
        await pgErrorCode(
          ctx.db.insert(workOrders).values({
            id: randomUUID(),
            workspaceId,
            assetId: otherAssetId,
            description: "Cross-workspace work order",
            createdByCommandId: commandId,
          }),
        ),
      ).toBe("23503");
    });
  });

  describe("asset_availability_intervals: partial unique open-interval index", () => {
    let issueId: string;

    beforeAll(async () => {
      issueId = randomUUID();
      await ctx.db.insert(operationalIssues).values({
        id: issueId,
        workspaceId,
        assetId,
        description: "Safety-critical issue",
        safetyCritical: true,
        reportedAt: new Date(),
        createdByCommandId: commandId,
      });
    });

    it("allows multiple closed intervals", async () => {
      await expect(
        ctx.db.insert(assetAvailabilityIntervals).values({
          workspaceId,
          assetId,
          openedAt: new Date("2026-01-01"),
          openedByIssueId: issueId,
          closedAt: new Date("2026-01-02"),
          createdByCommandId: commandId,
        }),
      ).resolves.toBeDefined();

      await expect(
        ctx.db.insert(assetAvailabilityIntervals).values({
          workspaceId,
          assetId,
          openedAt: new Date("2026-02-01"),
          openedByIssueId: issueId,
          closedAt: new Date("2026-02-02"),
          createdByCommandId: commandId,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a second open interval when one already exists", async () => {
      const interval1Id = randomUUID();
      const interval2Id = randomUUID();

      await ctx.db.insert(assetAvailabilityIntervals).values({
        id: interval1Id,
        workspaceId,
        assetId,
        openedAt: new Date("2026-03-01"),
        openedByIssueId: issueId,
        createdByCommandId: commandId,
      });

      expect(
        await pgErrorCode(
          ctx.db.insert(assetAvailabilityIntervals).values({
            id: interval2Id,
            workspaceId,
            assetId,
            openedAt: new Date("2026-03-02"),
            openedByIssueId: issueId,
            createdByCommandId: commandId,
          }),
        ),
      ).toBe("23505");
    });
  });
});
