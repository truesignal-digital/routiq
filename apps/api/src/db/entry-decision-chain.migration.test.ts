import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

type RuleRow = {
  command_type: string;
  amount_max_minor: string | null;
  required_role: string;
  row_version: number;
};

/**
 * 0037 on workspaces as 0036 left them: Finance and Direction unbounded on the
 * entry decisions, beside recording bands the tenant may have moved. Migrated to
 * 0036 from a truncated journal, seeded, then brought forward by the real
 * migrator. Its own database inside the suite's container (guard T1).
 */
describe("0037 entry decision chain", () => {
  const databaseName = `pre0037_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;

  const defaultWs = randomUUID();
  const movedWs = randomUUID();
  const unbandedWs = randomUUID();
  const tenantWs = randomUUID();
  const tenantCommand = randomUUID();
  const tenantRule = randomUUID();
  const provisionedWs = randomUUID();
  const provisioning = randomUUID();

  async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await pool.query(text, values)).rows as T[];
  }

  async function rule(
    workspaceId: string,
    commandType: string,
    role: string,
    amountMax: number | null = null,
  ): Promise<void> {
    // A provisioned workspace's defaults carry the provisioning receipt.
    await pool.query(
      `INSERT INTO approval_rules (workspace_id, command_type, amount_max_minor, required_role, created_by_command_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, commandType, amountMax, role, workspaceId === provisionedWs ? provisioning : null],
    );
  }

  async function entryDecisionRules(workspaceId: string): Promise<string[]> {
    const rows = await query<RuleRow>(
      `SELECT command_type, amount_max_minor::text, required_role, row_version
       FROM approval_rules
       WHERE workspace_id = $1 AND command_type IN ('approve-entry', 'reject-entry')`,
      [workspaceId],
    );
    return rows.map((row) => `${row.command_type}:${row.required_role}:${row.amount_max_minor ?? "*"}`).sort();
  }

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0037-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 36);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    for (const [id, slug] of [
      [defaultWs, "defaults"],
      [movedWs, "moved"],
      [unbandedWs, "unbanded"],
      [tenantWs, "tenant"],
      [provisionedWs, "provisioned"],
    ] as const) {
      await pool.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $2)`, [id, `pre0037-${slug}-${id.slice(0, 8)}`]);
    }
    const operator = randomUUID();
    await pool.query(`INSERT INTO principals (id, principal_type, display_name) VALUES ($1, 'HUMAN', 'Vendor operator')`, [operator]);
    await pool.query(
      `INSERT INTO commands (id, workspace_id, scope, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload, approval_outcome)
       VALUES ($1, $2, 'PLATFORM', 'provision-workspace', 'API', 'EXECUTED', $3, 'provision-1', '{}', 'AUTO_APPROVED')`,
      [provisioning, provisionedWs, operator],
    );

    for (const ws of [defaultWs, movedWs, unbandedWs, tenantWs, provisionedWs]) {
      for (const commandType of ["approve-entry", "reject-entry"]) {
        await rule(ws, commandType, "DIRECTOR");
        if (ws !== tenantWs) await rule(ws, commandType, "FINANCE");
      }
      for (const commandType of ["record-expense", "record-revenue"]) {
        await rule(ws, commandType, "FINANCE");
      }
    }
    for (const commandType of ["record-expense", "record-revenue"]) {
      await rule(defaultWs, commandType, "DRIVER", 100_000);
      await rule(provisionedWs, commandType, "DRIVER", 100_000);
      await rule(tenantWs, commandType, "DRIVER", 100_000);
    }
    // The tenant moved its bands: expenses up to 250 000, revenue to 80 000.
    await rule(movedWs, "record-expense", "DRIVER", 250_000);
    await rule(movedWs, "record-revenue", "CASHIER", 80_000);
    // A branch-only band does not set the workspace's top.
    const branch = randomUUID();
    await pool.query(`INSERT INTO branches (id, workspace_id, code, name) VALUES ($1, $2, 'DLA', 'Douala')`, [branch, movedWs]);
    await pool.query(
      `INSERT INTO approval_rules (workspace_id, command_type, branch_id, amount_max_minor, required_role)
       VALUES ($1, 'record-expense', $2, 900000, 'DRIVER')`,
      [movedWs, branch],
    );

    // A Finance rule a tenant command created: not a catalog default, left alone.
    const actor = randomUUID();
    await pool.query(`INSERT INTO principals (id, principal_type, display_name) VALUES ($1, 'HUMAN', 'Direction')`, [actor]);
    await pool.query(
      `INSERT INTO memberships (workspace_id, principal_id, role, all_branches) VALUES ($1, $2, 'DIRECTOR', true)`,
      [tenantWs, actor],
    );
    await pool.query(
      `INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload, approval_outcome)
       VALUES ($1, $2, 'update-approval-threshold', 'HUMAN_UI', 'EXECUTED', $3, 'tenant-1', '{}', 'AUTO_APPROVED')`,
      [tenantCommand, tenantWs, actor],
    );
    await pool.query(
      `INSERT INTO approval_rules (id, workspace_id, command_type, required_role, created_by_command_id)
       VALUES ($1, $2, 'approve-entry', 'FINANCE', $3)`,
      [tenantRule, tenantWs, tenantCommand],
    );

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  it("bands Finance at the default top band and gives Direction the band and the rest", async () => {
    for (const ws of [defaultWs, provisionedWs]) expect(await entryDecisionRules(ws)).toEqual(
      [
        "approve-entry:DIRECTOR:*",
        "approve-entry:DIRECTOR:100000",
        "approve-entry:FINANCE:100000",
        "reject-entry:DIRECTOR:*",
        "reject-entry:DIRECTOR:100000",
        "reject-entry:FINANCE:100000",
      ].sort(),
    );
  });

  it("follows the highest workspace-wide band the tenant set", async () => {
    expect(await entryDecisionRules(movedWs)).toEqual(
      [
        "approve-entry:DIRECTOR:*",
        "approve-entry:DIRECTOR:250000",
        "approve-entry:FINANCE:250000",
        "reject-entry:DIRECTOR:*",
        "reject-entry:DIRECTOR:250000",
        "reject-entry:FINANCE:250000",
      ].sort(),
    );
  });

  it("keeps Finance unbounded where no recording band is set", async () => {
    expect(await entryDecisionRules(unbandedWs)).toEqual(
      [
        "approve-entry:DIRECTOR:*",
        "approve-entry:FINANCE:*",
        "reject-entry:DIRECTOR:*",
        "reject-entry:FINANCE:*",
      ].sort(),
    );
  });

  it("leaves a rule a tenant command created untouched", async () => {
    const [row] = await query<RuleRow>(
      `SELECT command_type, amount_max_minor::text, required_role, row_version FROM approval_rules WHERE id = $1`,
      [tenantRule],
    );
    expect(row).toEqual({
      command_type: "approve-entry",
      amount_max_minor: null,
      required_role: "FINANCE",
      row_version: 1,
    });
    expect(await entryDecisionRules(tenantWs)).toEqual(
      ["approve-entry:DIRECTOR:*", "approve-entry:FINANCE:*", "reject-entry:DIRECTOR:*"].sort(),
    );
  });
});
