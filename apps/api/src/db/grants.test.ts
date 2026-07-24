import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../test/fixture.js";

/**
 * Convention guard: migrations must GRANT new tables to routiq_app explicitly
 * (no ALTER DEFAULT PRIVILEGES — see migration 0004). A failure here means a
 * migration added a table the runtime role cannot touch.
 */
describe("routiq_app grants", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function grantsByTable(): Promise<Map<string, Set<string>>> {
    const result = await ctx.db.execute(sql`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'routiq_app' and table_schema = 'public'
    `);
    const map = new Map<string, Set<string>>();
    for (const row of result.rows as { table_name: string; privilege_type: string }[]) {
      const set = map.get(row.table_name) ?? new Set<string>();
      set.add(row.privilege_type);
      map.set(row.table_name, set);
    }
    return map;
  }

  it("every public table is readable and writable by the runtime role", async () => {
    const tables = await ctx.db.execute(sql`
      select tablename from pg_tables
      where schemaname = 'public' and tablename not like '\\_\\_%'
    `);
    const grants = await grantsByTable();
    for (const { tablename } of tables.rows as { tablename: string }[]) {
      const privs = grants.get(tablename);
      expect(
        privs?.has("SELECT") && privs.has("INSERT"),
        `table "${tablename}" lacks routiq_app grants — the migration that created it ` +
          `must GRANT explicitly (default privileges are deliberately not configured).`,
      ).toBe(true);
    }
  });

  it("audit_events stays append-only for the runtime role", async () => {
    const grants = await grantsByTable();
    const privs = grants.get("audit_events");
    expect(privs?.has("SELECT")).toBe(true);
    expect(privs?.has("INSERT")).toBe(true);
    expect(privs?.has("UPDATE")).toBe(false);
    expect(privs?.has("DELETE")).toBe(false);
  });
});
