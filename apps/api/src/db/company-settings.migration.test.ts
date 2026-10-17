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
const TAG_SUFFIX = "_company_settings";

/**
 * Migration 0050 (#669) on a workspace that predates it: Direction gets the
 * catalog's rule for set-summary-schedule, so it never meets
 * APPROVAL_REQUIRED, and the workspace keeps the default schedule (no row).
 * Located by tag, so a renumber does not break it. Its own database inside
 * the suite's container (guard T1).
 */
describe("company settings migration", () => {
  const databaseName = `compset_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;
  const workspaceId = randomUUID();

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-compset-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const own = journal.entries.find((entry) => entry.tag.endsWith(TAG_SUFFIX));
    expect(own).toBeDefined();
    journal.entries = journal.entries.filter((entry) => entry.idx < own!.idx);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    await pool.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $2)`, [
      workspaceId,
      `compset-${workspaceId.slice(0, 8)}`,
    ]);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  it("gives an existing workspace the catalog's rule for set-summary-schedule", async () => {
    const rows = (
      await pool.query<{ required_role: string }>(
        `SELECT required_role FROM approval_rules
         WHERE workspace_id = $1 AND command_type = 'set-summary-schedule'
           AND category_code IS NULL AND branch_id IS NULL
           AND amount_min_minor IS NULL AND amount_max_minor IS NULL`,
        [workspaceId],
      )
    ).rows;
    const catalog = corePack.approvalRules
      .filter((rule) => rule.commandType === "set-summary-schedule")
      .map((rule) => rule.requiredRole);
    // 0051 (#711) adds the Administrators' rule after this one.
    expect(rows.map((row) => row.required_role).sort()).toEqual([...catalog].sort());
    expect(catalog).toContain("DIRECTOR");
  });

  it("leaves the workspace on the default schedule, and refuses a schedule outside the list", async () => {
    const settings = await pool.query(`SELECT * FROM company_settings WHERE workspace_id = $1`, [workspaceId]);
    expect(settings.rows).toEqual([]);
    // The check runs before the command FKs, which only fire at the end of the statement.
    const commandId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO company_settings (workspace_id, summary_schedule, created_by_command_id, updated_by_command_id)
         VALUES ($1, 'DAILY', $2, $2)`,
        [workspaceId, commandId],
      ),
    ).rejects.toThrow(/company_settings_summary_schedule_ck/);
  });

  it("adds nothing when the file runs again", async () => {
    const journal = JSON.parse(await readFile(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tag = journal.entries.find((entry) => entry.tag.endsWith(TAG_SUFFIX))!.tag;
    const fileSql = await readFile(join(MIGRATIONS, `${tag}.sql`), "utf8");
    const count = async () =>
      (
        await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM approval_rules
           WHERE workspace_id = $1 AND command_type = 'set-summary-schedule'`,
          [workspaceId],
        )
      ).rows[0]!.n;
    const before = await count();
    for (const statement of fileSql.split("--> statement-breakpoint")) {
      await pool.query(statement);
    }
    expect(await count()).toBe(before);
  });
});
