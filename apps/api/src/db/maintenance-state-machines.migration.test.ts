import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { corePack } from "../provisioning/packs/core.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));
const MIGRATION_0027 = join(MIGRATIONS, "0027_maintenance_state_machines.sql");

/** The command types and role rules 0027 backfills; the pack is the other copy. */
const BACKFILLED_COMMANDS = [
  "resolve-issue",
  "dismiss-issue",
  "reject-work-order",
  "reject-work-order-completion",
] as const;

/**
 * 0027 against a database that was running the pre-#28 maintenance module:
 * migrated to 0026 from a truncated journal, seeded with the old status values
 * and a tenant that had moved its expense threshold, then brought forward by
 * the real migrator — the path a deployed box takes. Its own database inside
 * the suite's container, so nothing here leaks into the shared one.
 */
describe("migration 0027 on a database that predates it", () => {
  const databaseName = `pre0027_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;

  const ws = randomUUID();
  const bareWs = randomUUID();
  const branch = randomUUID();
  const principal = randomUUID();
  const command = randomUUID();
  const asset = randomUUID();
  const issue = randomUUID();
  const orders = {
    OPEN: randomUUID(),
    PENDING_CLOSE: randomUUID(),
    CLOSED: randomUUID(),
    SUBMITTED: randomUUID(),
    CANCELLED: randomUUID(),
  } as const;

  async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await pool.query(text, values)).rows as T[];
  }

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0027-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 26);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    // The pre-#28 world: OPEN/PENDING_CLOSE/CLOSED orders, an issue with no
    // status column yet, a FIELD_SUBMITTER band the tenant moved to 250 000,
    // and a BRAKES issue type the tenant defined itself.
    await pool.query(`
      INSERT INTO workspaces (id, slug, name) VALUES
        ('${ws}', 'pre-0027-${ws.slice(0, 8)}', 'Transports Pré-0027'),
        ('${bareWs}', 'pre-0027-${bareWs.slice(0, 8)}', 'Atelier vierge');
      INSERT INTO branches (id, workspace_id, code, name) VALUES ('${branch}', '${ws}', 'DLA', 'Douala');
      INSERT INTO principals (id, principal_type, display_name) VALUES ('${principal}', 'HUMAN', 'Admin');
      INSERT INTO memberships (workspace_id, principal_id, role, all_branches)
        VALUES ('${ws}', '${principal}', 'ADMIN', true);
      INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload)
        VALUES ('${command}', '${ws}', 'register-asset', 'HUMAN_UI', 'EXECUTED', '${principal}', 'seed-1', '{}');
      INSERT INTO assets (id, workspace_id, branch_id, asset_code, asset_class_code, template_code, created_by_command_id)
        VALUES ('${asset}', '${ws}', '${branch}', 'TRK-001', 'TRUCK', 'TRUCKING', '${command}');
      INSERT INTO operational_issues (id, workspace_id, asset_id, description, safety_critical, reported_at, created_by_command_id)
        VALUES ('${issue}', '${ws}', '${asset}', 'Freins', true, now(), '${command}');
      INSERT INTO work_orders (id, workspace_id, asset_id, issue_id, description, status, created_by_command_id) VALUES
        ('${orders.OPEN}', '${ws}', '${asset}', '${issue}', 'a', 'OPEN', '${command}'),
        ('${orders.PENDING_CLOSE}', '${ws}', '${asset}', '${issue}', 'b', 'PENDING_CLOSE', '${command}'),
        ('${orders.CLOSED}', '${ws}', '${asset}', '${issue}', 'c', 'CLOSED', '${command}'),
        ('${orders.SUBMITTED}', '${ws}', '${asset}', NULL, 'd', 'SUBMITTED', '${command}'),
        ('${orders.CANCELLED}', '${ws}', '${asset}', NULL, 'e', 'CANCELLED', '${command}');
      INSERT INTO approval_rules (workspace_id, command_type, amount_max_minor, required_role)
        VALUES ('${ws}', 'record-expense', 250000, 'FIELD_SUBMITTER');
      INSERT INTO categories (workspace_id, kind, code, label_fr, label_en)
        VALUES ('${ws}', 'ISSUE_TYPE', 'BRAKES', 'Freinage (maison)', 'Brakes (own)');
    `);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  async function snapshot() {
    return {
      orders: await query<{ id: string; status: string; row_version: number }>(
        `SELECT id, status, row_version FROM work_orders ORDER BY id`,
      ),
      issues: await query<{ id: string; status: string; row_version: number }>(
        `SELECT id, status, row_version FROM operational_issues ORDER BY id`,
      ),
      rules: await query<{ n: string }>(`SELECT count(*)::text AS n FROM approval_rules`),
      categories: await query<{ n: string }>(`SELECT count(*)::text AS n FROM categories`),
    };
  }

  it("renames the pre-#28 statuses in place, leaving row versions alone", async () => {
    const rows = await query<{ id: string; status: string; row_version: number }>(
      `SELECT id, status, row_version FROM work_orders`,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(orders.OPEN)).toMatchObject({ status: "APPROVED", row_version: 1 });
    expect(byId.get(orders.PENDING_CLOSE)).toMatchObject({
      status: "COMPLETION_SUBMITTED",
      row_version: 1,
    });
    expect(byId.get(orders.CLOSED)).toMatchObject({ status: "COMPLETED", row_version: 1 });
    expect(byId.get(orders.SUBMITTED)).toMatchObject({ status: "SUBMITTED" });
    expect(byId.get(orders.CANCELLED)).toMatchObject({ status: "CANCELLED" });

    const [column] = await query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'work_orders' AND column_name = 'status'`,
    );
    expect(column?.column_default).toContain("APPROVED");
  });

  it("lands every existing signalement OPEN — no resolution is invented", async () => {
    expect(
      await query(`SELECT status, resolved_at FROM operational_issues WHERE id = $1`, [issue]),
    ).toEqual([{ status: "OPEN", resolved_at: null }]);
    expect(
      await query(`SELECT resolve_linked_issue FROM work_orders WHERE id = $1`, [
        orders.PENDING_CLOSE,
      ]),
    ).toEqual([{ resolve_linked_issue: false }]);
  });

  it("backfills the new commands' rules exactly as a new workspace is provisioned", async () => {
    for (const workspaceId of [ws, bareWs]) {
      const backfilled = (
        await query<{ command_type: string; required_role: string }>(
          `SELECT command_type, required_role FROM approval_rules
           WHERE workspace_id = $1 AND command_type = ANY($2)`,
          [workspaceId, [...BACKFILLED_COMMANDS]],
        )
      )
        .map((rule) => `${rule.command_type}:${rule.required_role}`)
        .sort();
      const provisioned = corePack.approvalRules
        .filter((rule) => (BACKFILLED_COMMANDS as readonly string[]).includes(rule.commandType))
        .map((rule) => `${rule.commandType}:${rule.requiredRole}`)
        .sort();
      expect(backfilled).toEqual(provisioned);
      expect(backfilled).toContain("resolve-issue:FIELD_SUBMITTER");
      expect(backfilled).not.toContain("dismiss-issue:FIELD_SUBMITTER");

      expect(
        await query(
          `SELECT 1 FROM approval_rules WHERE workspace_id = $1
             AND command_type = 'record-meter-reading' AND required_role = 'MAINTENANCE'`,
          [workspaceId],
        ),
      ).toHaveLength(1);
    }
  });

  it("gives MAINTENANCE the workspace's own expense band, or the catalog's where none exists", async () => {
    const band = (workspaceId: string) =>
      query<{ amount_max_minor: string }>(
        `SELECT amount_max_minor::text FROM approval_rules
         WHERE workspace_id = $1 AND command_type = 'record-expense' AND required_role = 'MAINTENANCE'`,
        [workspaceId],
      );
    expect(await band(ws)).toEqual([{ amount_max_minor: "250000" }]);
    expect(await band(bareWs)).toEqual([{ amount_max_minor: "100000" }]);
  });

  it("seeds the ISSUE_TYPE vocabulary without overwriting a tenant's own row", async () => {
    const issueTypes = await query<{
      code: string;
      label_fr: string;
      default_safety_critical: boolean;
    }>(
      `SELECT code, label_fr, default_safety_critical FROM categories
       WHERE workspace_id = $1 AND kind = 'ISSUE_TYPE' ORDER BY code`,
      [ws],
    );
    expect(issueTypes.map((row) => row.code)).toEqual([
      "BODYWORK",
      "BRAKES",
      "ENGINE",
      "LIGHTING",
      "OTHER",
      "STEERING",
      "TYRES",
    ]);
    expect(issueTypes.find((row) => row.code === "BRAKES")).toEqual({
      code: "BRAKES",
      label_fr: "Freinage (maison)",
      default_safety_critical: false,
    });
    expect(issueTypes.find((row) => row.code === "STEERING")?.default_safety_critical).toBe(true);
  });

  it("finds nothing to do on a second run", async () => {
    const before = await snapshot();
    const statements = (await readFile(MIGRATION_0027, "utf8"))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await pool.query(statement);
    }
    expect(await snapshot()).toEqual(before);
    expect(await query(`SELECT 1 FROM work_orders WHERE status IN ('OPEN','PENDING_CLOSE','CLOSED')`))
      .toHaveLength(0);
  });

  it("opens only the status columns of a signalement to the runtime role", async () => {
    const columns = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.role_column_grants
       WHERE grantee = 'routiq_app' AND table_name = 'operational_issues'
         AND privilege_type = 'UPDATE' ORDER BY column_name`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      "dismiss_reason",
      "dismissed_at",
      "resolution_note",
      "resolved_at",
      "row_version",
      "status",
    ]);
    // Keep drizzle's own bookkeeping honest: the migrator recorded 0027 once.
    const applied = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(Number(applied[0]?.n)).toBe(28);
  });
});
