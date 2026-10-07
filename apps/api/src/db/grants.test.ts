import { getTableName, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../test/fixture.js";
import { APPEND_ONLY_TABLES, type AppendOnlyTable } from "./append-only.js";
import * as schema from "./schema.js";

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

  async function updatableColumns(): Promise<Map<string, string[]>> {
    const result = await ctx.db.execute(sql`
      select table_name, column_name
      from information_schema.role_column_grants
      where grantee = 'routiq_app' and table_schema = 'public' and privilege_type = 'UPDATE'
    `);
    const map = new Map<string, string[]>();
    for (const row of result.rows as { table_name: string; column_name: string }[]) {
      map.set(row.table_name, [...(map.get(row.table_name) ?? []), row.column_name].sort());
    }
    return map;
  }

  // #154: the inventory in append-only.ts is what guard A27 protects in code;
  // these two checks keep it equal to what the database actually refuses.
  it("holds exactly the append-only privileges the inventory documents", async () => {
    const grants = await grantsByTable();
    const columns = await updatableColumns();
    for (const table of Object.keys(APPEND_ONLY_TABLES) as AppendOnlyTable[]) {
      const name = getTableName(schema[table]);
      const { update, delete: remove } = APPEND_ONLY_TABLES[table];
      const privs = grants.get(name);
      expect(privs?.has("SELECT") && privs.has("INSERT"), `${name} must stay readable and insertable`).toBe(true);
      expect(privs?.has("UPDATE"), `${name} must not grant a table-wide UPDATE`).toBe(false);
      expect(columns.get(name) ?? [], `${name} updatable columns`).toEqual([...update].sort());
      expect(privs?.has("DELETE"), `${name} DELETE`).toBe(remove !== "never");
    }
  });

  it("lists every table the runtime role can neither update nor delete from", async () => {
    const tables = await ctx.db.execute(sql`
      select tablename from pg_tables
      where schemaname = 'public' and tablename not like '\\_\\_%'
    `);
    const grants = await grantsByTable();
    const columns = await updatableColumns();
    const listed = new Set<string>(
      (Object.keys(APPEND_ONLY_TABLES) as AppendOnlyTable[]).map((table) => getTableName(schema[table])),
    );
    const unlisted = (tables.rows as { tablename: string }[])
      .map(({ tablename }) => tablename)
      .filter((name) => {
        const privs = grants.get(name);
        return !privs?.has("UPDATE") && !privs?.has("DELETE") && !columns.has(name) && !listed.has(name);
      });
    expect(unlisted, "append-only in the database but missing from db/append-only.ts").toEqual([]);
  });

  it("audit_events stays append-only for the runtime role", async () => {
    const grants = await grantsByTable();
    const privs = grants.get("audit_events");
    expect(privs?.has("SELECT")).toBe(true);
    expect(privs?.has("INSERT")).toBe(true);
    expect(privs?.has("UPDATE")).toBe(false);
    expect(privs?.has("DELETE")).toBe(false);
  });

  it("financial rows keep the intended append-only runtime grants", async () => {
    const grants = await grantsByTable();
    const entries = grants.get("financial_entries");
    expect(entries?.has("UPDATE")).toBe(true);
    expect(entries?.has("DELETE")).toBe(false);

    // DELETE only for the lines of a pending entry its author edits (#85):
    // financial_postings_pending_delete refuses every other delete (0034).
    const postings = grants.get("financial_postings");
    expect(postings?.has("UPDATE")).toBe(false);
    expect(postings?.has("DELETE")).toBe(true);
    const deleteGuard = await ctx.db.execute(sql`
      select tgname from pg_trigger
      where tgrelid = 'financial_postings'::regclass and tgname = 'financial_postings_pending_delete'
    `);
    expect(deleteGuard.rows).toHaveLength(1);

    const columnGrants = await ctx.db.execute(sql`
      select column_name
      from information_schema.role_column_grants
      where grantee = 'routiq_app'
        and table_schema = 'public'
        and table_name = 'financial_postings'
        and privilege_type = 'UPDATE'
    `);
    expect(columnGrants.rows).toEqual([
      expect.objectContaining({ column_name: "posting_period_id" }),
    ]);
  });

  it("notes are append-only for the runtime role, behind forced RLS", async () => {
    const grants = await grantsByTable();
    const privs = grants.get("notes");
    expect(privs?.has("SELECT")).toBe(true);
    expect(privs?.has("INSERT")).toBe(true);
    expect(privs?.has("UPDATE")).toBe(false);
    expect(privs?.has("DELETE")).toBe(false);

    const rls = await ctx.db.execute(sql`
      select relrowsecurity, relforcerowsecurity from pg_class
      where relname = 'notes' and relnamespace = 'public'::regnamespace
    `);
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it("maintenance rows keep the intended append-only runtime grants", async () => {
    const grants = await grantsByTable();

    // A signalement is an append-only observation: a later look at the same
    // truck is a new issue, never an edit of the old one.
    const issues = grants.get("operational_issues");
    expect(issues?.has("SELECT")).toBe(true);
    expect(issues?.has("INSERT")).toBe(true);
    expect(issues?.has("UPDATE")).toBe(false);
    expect(issues?.has("DELETE")).toBe(false);

    // #28: a signalement's status moves once — resolved or dismissed — and the
    // report itself never does, so UPDATE reaches only the status columns.
    const issueColumnGrants = await ctx.db.execute(sql`
      select column_name
      from information_schema.role_column_grants
      where grantee = 'routiq_app'
        and table_schema = 'public'
        and table_name = 'operational_issues'
        and privilege_type = 'UPDATE'
    `);
    expect(
      (issueColumnGrants.rows as { column_name: string }[])
        .map((row) => row.column_name)
        .sort(),
    ).toEqual([
      "dismiss_reason",
      "dismissed_at",
      "resolution_note",
      "resolved_at",
      "row_version",
      "status",
    ]);

    // A work order's status moves, so UPDATE is the transition path — but
    // cancelling stamps a reason rather than removing the row.
    const orders = grants.get("work_orders");
    expect(orders?.has("SELECT")).toBe(true);
    expect(orders?.has("INSERT")).toBe(true);
    expect(orders?.has("UPDATE")).toBe(true);
    expect(orders?.has("DELETE")).toBe(false);

    // An availability interval is opened by report-issue and closed — never
    // deleted — by release-asset-to-service.
    const intervals = grants.get("asset_availability_intervals");
    expect(intervals?.has("SELECT")).toBe(true);
    expect(intervals?.has("INSERT")).toBe(true);
    expect(intervals?.has("UPDATE")).toBe(true);
    expect(intervals?.has("DELETE")).toBe(false);
  });
});
