import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands, numberCounters, operationalIssues, workOrders } from "./schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

const DRIZZLE = fileURLToPath(new URL("../../drizzle/", import.meta.url));

async function migrationSql(): Promise<string[]> {
  const name = (await readdir(DRIZZLE)).find((file) => /^\d{4}_maintenance_numbers\.sql$/.test(file));
  if (name === undefined) throw new Error("no *_maintenance_numbers.sql migration");
  return (await readFile(`${DRIZZLE}${name}`, "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Ids that sort the reverse of the order the records are created in. */
const descendingIds = (prefix: string) =>
  ["f", "8", "1"].map((head) => `${head}${prefix}00000-0000-4000-8000-000000000000`);

/**
 * Existing work orders and problems get numbers in the order they were
 * created (#608): the creating command's commit, not the uuid and not the
 * device's report time. Runs the shipped SQL against rows that predate it.
 */
describe("maintenance numbers back-fill (#608)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let statements: string[];
  const tenants: Array<{ actor: Actor; issueIds: string[]; orderIds: string[] }> = [];

  beforeAll(async () => {
    ctx = await createTestApp({ isolated: true });
    api = apiClient(ctx.app);
    statements = await migrationSql();

    for (const tag of ["a", "b"]) {
      const seeded = await seedWorkspace(ctx.db);
      const actor = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN" });
      const truck = await seedAsset(ctx.app, actor.token);
      const issueIds = descendingIds(`${tag}1`);
      const orderIds = descendingIds(`${tag}2`);
      // Reported on the device in the reverse order: the back-fill must not read it.
      for (const [i, issueId] of issueIds.entries()) {
        await api.ok(
          actor.token,
          "report-issue",
          { issueId, assetId: truck, description: `Problème ${i}`, safetyCritical: false },
          { clientOccurredAt: new Date(Date.UTC(2026, 0, 10 - i)).toISOString() },
        );
      }
      for (const [i, workOrderId] of orderIds.entries()) {
        await api.ok(actor.token, "create-work-order", {
          workOrderId,
          assetId: truck,
          description: `Réparation ${i}`,
          expectedCostMinor: 0,
        });
      }
      tenants.push({ actor, issueIds, orderIds });
    }

    // The schema as it was before the migration: no columns, no counters.
    await ctx.db.execute(sql`alter table work_orders drop column number cascade`);
    await ctx.db.execute(sql`alter table operational_issues drop column number cascade`);
    await ctx.db.execute(sql`delete from number_counters where scope in ('WORK_ORDER', 'ISSUE')`);
    for (const statement of statements) await ctx.db.execute(sql.raw(statement));
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function numbersOf(table: typeof workOrders | typeof operationalIssues, ids: string[]) {
    const rows = await ctx.db
      .select({ id: table.id, number: table.number })
      .from(table)
      .where(inArray(table.id, ids));
    return ids.map((id) => rows.find((row) => row.id === id)?.number);
  }

  it("numbers each workspace's rows 1, 2, 3 in creation order", async () => {
    for (const tenant of tenants) {
      expect(await numbersOf(operationalIssues, tenant.issueIds)).toEqual([1, 2, 3]);
      expect(await numbersOf(workOrders, tenant.orderIds)).toEqual([1, 2, 3]);
    }
  });

  it("follows the creating command's commit time", async () => {
    const [tenant] = tenants;
    const executed = await ctx.db
      .select({ number: workOrders.number, executedAt: commands.executedAt })
      .from(workOrders)
      .innerJoin(commands, eq(commands.id, workOrders.createdByCommandId))
      .where(inArray(workOrders.id, tenant!.orderIds))
      .orderBy(asc(commands.executedAt));
    expect(executed.map((row) => row.number)).toEqual([1, 2, 3]);
  });

  it("seeds the counters so the next create continues the sequence", async () => {
    const [tenant] = tenants;
    const detail = await api.get(tenant!.actor.token, `/v1/work-orders/${tenant!.orderIds[0]}`);
    const assetId = (detail.body as { asset: { id: string } }).asset.id;
    const workOrderId = randomUUID();
    await api.ok(tenant!.actor.token, "create-work-order", {
      workOrderId,
      assetId,
      description: "Après la migration",
      expectedCostMinor: 0,
    });
    expect(await numbersOf(workOrders, [workOrderId])).toEqual([4]);
  });

  it("keeps a work order's number fixed once given", async () => {
    const [tenant] = tenants;
    await expect(
      ctx.db.execute(sql`update work_orders set number = 99 where id = ${tenant!.orderIds[0]}`),
    ).rejects.toThrow();
  });

  it("changes nothing when applied again", async () => {
    const before = await ctx.db
      .select({ workspaceId: numberCounters.workspaceId, scope: numberCounters.scope, next: numberCounters.nextValue })
      .from(numberCounters)
      .where(inArray(numberCounters.scope, ["WORK_ORDER", "ISSUE"]));
    for (const statement of statements) await ctx.db.execute(sql.raw(statement));
    const after = await ctx.db
      .select({ workspaceId: numberCounters.workspaceId, scope: numberCounters.scope, next: numberCounters.nextValue })
      .from(numberCounters)
      .where(inArray(numberCounters.scope, ["WORK_ORDER", "ISSUE"]));
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toHaveLength(before.length);
    for (const tenant of tenants) {
      expect(await numbersOf(operationalIssues, tenant.issueIds)).toEqual([1, 2, 3]);
    }
  });
});
