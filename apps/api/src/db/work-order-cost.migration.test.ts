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

/**
 * 0030/0031 (#81) on a database that predates them: a work order closed with a
 * typed amount keeps that amount as its declared cost, and no cost outcome is
 * guessed for it. Migrated to 0029 from a truncated journal, then brought
 * forward by the real migrator — the path a deployed box takes.
 */
describe("work-order cost migrations on a database that predates them", () => {
  const databaseName = `pre0030_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;

  const ws = randomUUID();
  const branch = randomUUID();
  const principal = randomUUID();
  const command = randomUUID();
  const asset = randomUUID();
  const typed = randomUUID();
  const untyped = randomUUID();

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0030-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 29);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    await pool.query(`
      INSERT INTO workspaces (id, slug, name) VALUES ('${ws}', 'pre-0030-${ws.slice(0, 8)}', 'Transports Pré-0030');
      INSERT INTO branches (id, workspace_id, code, name) VALUES ('${branch}', '${ws}', 'DLA', 'Douala');
      INSERT INTO principals (id, principal_type, display_name) VALUES ('${principal}', 'HUMAN', 'Boris');
      INSERT INTO memberships (id, workspace_id, principal_id, role, all_branches) VALUES
        ('${randomUUID()}', '${ws}', '${principal}', 'OPS_MANAGER', true);
      INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload) VALUES
        ('${command}', '${ws}', 'register-asset', 'HUMAN_UI', 'EXECUTED', '${principal}', 'seed-1', '{}');
      INSERT INTO assets (id, workspace_id, branch_id, asset_code, asset_class_code, template_code, created_by_command_id) VALUES
        ('${asset}', '${ws}', '${branch}', 'VH003', 'TRUCK', 'TRUCKING', '${command}');
      INSERT INTO work_orders (id, workspace_id, asset_id, description, status, expected_cost_minor, actual_cost_minor, created_by_command_id) VALUES
        ('${typed}', '${ws}', '${asset}', 'Freins', 'COMPLETED', 45000, 50000, '${command}'),
        ('${untyped}', '${ws}', '${asset}', 'Vidange', 'APPROVED', 20000, NULL, '${command}');
    `);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  it("keeps a typed amount as the declared cost and guesses no outcome", async () => {
    const { rows } = await pool.query<{ id: string; declared: string | null; outcome: string | null }>(
      `SELECT id, declared_cost_minor::text AS declared, cost_outcome AS outcome
         FROM work_orders WHERE workspace_id = $1`,
      [ws],
    );
    expect(new Map(rows.map((row) => [row.id, row]))).toEqual(
      new Map([
        [typed, { id: typed, declared: "50000", outcome: null }],
        [untyped, { id: untyped, declared: null, outcome: null }],
      ]),
    );
  });

  it("drops the typed column: nothing reads it as cost any more", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_orders' AND column_name = 'actual_cost_minor'`,
    );
    expect(rows).toEqual([]);
  });
});
