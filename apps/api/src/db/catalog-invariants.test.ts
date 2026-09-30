import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../test/fixture.js";

/**
 * The schema's tenant rules, checked in the migrated catalog rather than
 * remembered by whoever writes the next migration (ARCHITECTURE.md §4.1).
 * Every new table has to satisfy each rule or be named below with a reason,
 * so the decision is made once, in review, instead of by omission.
 *
 * KNOWN_* lists are baselines: they may only shrink. A fixed gap fails the
 * test until it is removed from its list, so the improvement is locked in.
 */

/** Tables with no tenant: the workspace itself and the workspace-free identity. */
const NOT_TENANT_SCOPED = ["principals", "workspaces"];

/** Tenant tables that are infrastructure or identity, not business records, so carry no created_by_command_id. */
const NO_PROVENANCE: Record<string, string> = {
  audit_events: "the audit trail itself; each row names its command_id",
  command_source_artifacts: "join table written with the command it links",
  commands: "the command receipts that provenance points at",
  credentials: "authentication state",
  memberships: "identity; membership changes are audited through commands",
  number_counters: "sequence state for entry numbers",
  sessions: "authentication state",
  source_artifacts: "evidence files; linked to commands via command_source_artifacts",
  workspace_modules: "entitlement row; carries updated_by_command_id",
  workspace_templates: "preset row; carries updated_by_command_id",
};

/** Tables the runtime may UPDATE without a row_version, and why that is safe. */
const UPDATABLE_WITHOUT_ROW_VERSION: Record<string, string> = {
  commands: "the dispatcher finalises its own receipt inside the command's transaction",
  credentials: "PIN resets and lockout counters (commands/members.ts, auth/local.ts)",
  number_counters: "allocated with INSERT … ON CONFLICT DO UPDATE",
};

/** Baseline: single-column tenant references with no composite (workspace_id, column) key (#72). */
const KNOWN_MISSING_TENANT_FK: string[] = [];

/** Baseline: UPDATE granted by the blanket 0004 grant, used by no code, and no row_version (#72). */
const KNOWN_UPDATABLE_WITHOUT_VERSION: string[] = [];

/** Records corrected only by superseding or reversing, never edited (§3.4). */
const APPEND_ONLY = [
  "audit_events",
  "command_source_artifacts",
  "documents",
  "financial_postings",
  "meter_readings",
  "notes",
  "source_artifacts",
];

/** Records whose status moves forward but which are never deleted. */
const NEVER_DELETED = [
  "activity_people",
  "asset_availability_intervals",
  "financial_entries",
  "movement_legs",
  "operational_issues",
  "work_orders",
  "workspace_templates",
];

describe("schema catalog invariants", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tables: { name: string; tenant: boolean; rls: boolean; forced: boolean; policies: number; provenance: boolean; rowVersion: boolean; update: boolean; delete: boolean }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    const result = await ctx.db.execute(sql`
      select c.relname as name,
        exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped) as tenant,
        c.relrowsecurity as rls,
        c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
        exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'created_by_command_id' and not a.attisdropped) as provenance,
        exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'row_version' and not a.attisdropped) as "rowVersion",
        has_table_privilege('routiq_app', c.oid, 'UPDATE') as update,
        has_table_privilege('routiq_app', c.oid, 'DELETE') as delete
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '__drizzle_migrations'
      order by 1
    `);
    tables = result.rows as typeof tables;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const tenantTables = () => tables.filter((t) => t.tenant);

  it("scopes every table to a workspace, except the workspace and identity tables", () => {
    expect(tables.filter((t) => !t.tenant).map((t) => t.name)).toEqual(NOT_TENANT_SCOPED);
  });

  it("enables and forces row-level security with a policy on every tenant table", () => {
    const unguarded = tenantTables()
      .filter((t) => !t.rls || !t.forced || t.policies === 0)
      .map((t) => t.name);
    expect(unguarded).toEqual([]);
  });

  it("backs every reference between tenant tables with a composite tenant key", async () => {
    const result = await ctx.db.execute(sql`
      with tenant as (
        select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped)
      ), fk as (
        select con.conrelid, con.confrelid,
          array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.ord) as cols
        from pg_constraint con where con.contype = 'f'
      )
      select s.conrelid::regclass::text || '.' || s.cols[1] || ' → ' || s.confrelid::regclass::text as gap
      from fk s
      where array_length(s.cols, 1) = 1
        and s.conrelid in (select oid from tenant) and s.confrelid in (select oid from tenant)
        and not exists (
          select 1 from fk c
          where c.conrelid = s.conrelid and c.confrelid = s.confrelid
            and 'workspace_id' = any(c.cols) and s.cols[1] = any(c.cols) and array_length(c.cols, 1) = 2
        )
      order by 1
    `);
    const gaps = (result.rows as { gap: string }[]).map((r) => r.gap);
    expect(gaps.filter((g) => !KNOWN_MISSING_TENANT_FK.includes(g)), "new reference without a composite tenant FK").toEqual([]);
    expect(KNOWN_MISSING_TENANT_FK.filter((g) => !gaps.includes(g)), "fixed: remove from KNOWN_MISSING_TENANT_FK").toEqual([]);
  });

  it("stamps every business table with the command that created its rows", () => {
    const missing = tenantTables()
      .filter((t) => !t.provenance && !(t.name in NO_PROVENANCE))
      .map((t) => t.name);
    expect(missing).toEqual([]);
    const stale = Object.keys(NO_PROVENANCE).filter((name) => tables.find((t) => t.name === name)?.provenance !== false);
    expect(stale, "listed in NO_PROVENANCE but has provenance or no longer exists").toEqual([]);
  });

  it("gives every table the runtime may update a row_version", () => {
    const missing = tables
      .filter((t) => t.update && !t.rowVersion && !(t.name in UPDATABLE_WITHOUT_ROW_VERSION))
      .map((t) => t.name);
    expect(missing.filter((n) => !KNOWN_UPDATABLE_WITHOUT_VERSION.includes(n)), "new updatable table without row_version").toEqual([]);
    expect(KNOWN_UPDATABLE_WITHOUT_VERSION.filter((n) => !missing.includes(n)), "fixed: remove from KNOWN_UPDATABLE_WITHOUT_VERSION").toEqual([]);
  });

  it("keeps append-only records free of UPDATE and DELETE for the runtime", () => {
    const writable = APPEND_ONLY.filter((name) => {
      const t = tables.find((row) => row.name === name);
      return t === undefined || t.update || t.delete;
    });
    expect(writable).toEqual([]);
  });

  it("never lets the runtime delete records whose history matters", () => {
    const deletable = NEVER_DELETED.filter((name) => tables.find((row) => row.name === name)?.delete !== false);
    expect(deletable).toEqual([]);
  });
});
