import { randomUUID } from "node:crypto";
import { eq, getTableName, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { APPEND_ONLY_TABLES, type AppendOnlyTable } from "./append-only.js";
import * as schema from "./schema.js";
import { inWorkspace } from "./tenant.js";

/**
 * #154: what guard A27 cannot read, the database refuses. Every statement here
 * runs as the runtime role `routiq_app`, the role the API connects as, so a
 * table handed through a variable or a name assembled at run time still
 * meets the grant. The owner role that runs migrations, seeds and test setup
 * keeps every privilege.
 */
describe("append-only tables in the database", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let driver: Actor;
  let noteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    const assetId = await seedAsset(ctx.app, admin.token, { assetCode: "APPEND-01" });
    noteId = randomUUID();
    await apiClient(ctx.app).ok(driver.token, "add-note", {
      noteId,
      entityType: "asset",
      entityId: assetId,
      body: "Pneu avant gauche usé",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const tables = Object.keys(APPEND_ONLY_TABLES) as AppendOnlyTable[];
  const sqlName = (table: AppendOnlyTable) => getTableName(schema[table]);

  function asRuntime(statement: ReturnType<typeof sql>) {
    return inWorkspace(ctx.runtimeDb, workspaceId, (tx) => tx.execute(statement));
  }

  it("refuses to edit a note written through add-note, and the note stays as written", async () => {
    await expect(
      asRuntime(sql`update notes set body = ${"Pneu changé"} where id = ${noteId}`),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(asRuntime(sql`delete from notes where id = ${noteId}`)).rejects.toMatchObject({
      cause: { code: "42501" },
    });

    const [row] = await ctx.db.select().from(schema.notes).where(eq(schema.notes.id, noteId));
    expect(row?.body).toBe("Pneu avant gauche usé");
  });

  it("refuses the note's audit event the same way", async () => {
    const statement = sql`update audit_events set event_type = 'tampered' where entity_id = ${noteId}`;
    await expect(asRuntime(statement)).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it.each(tables)("refuses an UPDATE of any column %s has no correction link for", async (table) => {
    const statement = sql`update ${sql.identifier(sqlName(table))} set workspace_id = workspace_id where false`;
    await expect(asRuntime(statement)).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it.each(tables.filter((table) => APPEND_ONLY_TABLES[table].delete === "never"))(
    "refuses a DELETE from %s",
    async (table) => {
      const statement = sql`delete from ${sql.identifier(sqlName(table))} where false`;
      await expect(asRuntime(statement)).rejects.toMatchObject({ cause: { code: "42501" } });
    },
  );

  it.each(tables.filter((table) => APPEND_ONLY_TABLES[table].update.length > 0))(
    "still lets %s take its correction link",
    async (table) => {
      const columns = APPEND_ONLY_TABLES[table].update.map((column) => sql`${sql.identifier(column)} = ${sql.identifier(column)}`);
      const statement = sql`update ${sql.identifier(sqlName(table))} set ${sql.join(columns, sql`, `)} where false`;
      await expect(asRuntime(statement)).resolves.toBeDefined();
    },
  );

  it("leaves the owner role free to reset or migrate", async () => {
    await expect(
      ctx.db.transaction(async (tx) => {
        await tx.execute(sql`update notes set body = body where id = ${noteId}`);
        await tx.execute(sql`delete from audit_events where false`);
      }),
    ).resolves.toBeUndefined();
  });
});
