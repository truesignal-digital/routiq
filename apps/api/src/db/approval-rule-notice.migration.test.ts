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

/**
 * 0039 on a workspace as 0038 left it (#422): the release that changed the
 * chain is noted once, for FINANCE and ADMIN, naming no member; every role may
 * acknowledge. Its own database inside the suite's container (guard T1).
 */
describe("0039 approval rule notice", () => {
  const databaseName = `pre0039_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;
  const workspaceId = randomUUID();

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
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0039-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 38);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    await pool.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $2)`, [
      workspaceId,
      `pre0039-${workspaceId.slice(0, 8)}`,
    ]);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  it("notes the 0038 release once, for Finance and the Administrateur, naming no member", async () => {
    const rows = await query<{ affected_roles: string[]; created_by_command_id: string | null }>(
      `SELECT affected_roles, created_by_command_id FROM approval_rule_changes WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(rows).toEqual([{ affected_roles: ["FINANCE", "ADMIN"], created_by_command_id: null }]);
  });

  it("lets every role acknowledge, as a new workspace's catalog does", async () => {
    const rows = await query<{ required_role: string }>(
      `SELECT required_role FROM approval_rules
       WHERE workspace_id = $1 AND command_type = 'acknowledge-approval-rules'
         AND category_code IS NULL AND branch_id IS NULL
         AND amount_min_minor IS NULL AND amount_max_minor IS NULL`,
      [workspaceId],
    );
    const catalog = corePack.approvalRules
      .filter((rule) => rule.commandType === "acknowledge-approval-rules")
      .map((rule) => rule.requiredRole)
      .sort();
    expect(rows.map((row) => row.required_role).sort()).toEqual(catalog);
    expect(catalog).toHaveLength(6);
  });
});
