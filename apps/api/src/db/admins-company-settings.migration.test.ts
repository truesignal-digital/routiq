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
const TAG_SUFFIX = "_admins_company_settings";
const COMMANDS = ["update-approval-threshold", "set-summary-schedule"] as const;

/**
 * Migration 0051 (#711) on a workspace that predates it: the Administrators
 * get the catalog's rule for each company-settings command, so their call
 * never meets APPROVAL_REQUIRED, and a second run adds nothing. Located by
 * tag, so a renumber does not break it. Its own database inside the suite's
 * container (guard T1).
 */
describe("admins company settings migration", () => {
  const databaseName = `admset_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-admset-"));
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
      `admset-${workspaceId.slice(0, 8)}`,
    ]);
    // What an existing workspace held before: Direction's rule alone.
    for (const commandType of COMMANDS) {
      await pool.query(
        `INSERT INTO approval_rules (workspace_id, command_type, required_role) VALUES ($1, $2, 'DIRECTOR')`,
        [workspaceId, commandType],
      );
    }

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  async function rolesFor(commandType: string): Promise<string[]> {
    const rows = (
      await pool.query<{ required_role: string }>(
        `SELECT required_role FROM approval_rules
         WHERE workspace_id = $1 AND command_type = $2
           AND category_code IS NULL AND branch_id IS NULL
           AND amount_min_minor IS NULL AND amount_max_minor IS NULL`,
        [workspaceId, commandType],
      )
    ).rows;
    return rows.map((row) => row.required_role).sort();
  }

  it.each(COMMANDS)("gives an existing workspace the catalog's workspace-wide rules for %s", async (commandType) => {
    const catalog = corePack.approvalRules
      .filter((rule) => rule.commandType === commandType)
      .map((rule) => rule.requiredRole)
      .sort();
    expect(catalog).toEqual(["ADMIN", "DIRECTOR"]);
    expect(await rolesFor(commandType)).toEqual(catalog);
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
           WHERE workspace_id = $1 AND command_type = ANY($2)`,
          [workspaceId, [...COMMANDS]],
        )
      ).rows[0]!.n;
    const before = await count();
    for (const statement of fileSql.split("--> statement-breakpoint")) {
      await pool.query(statement);
    }
    expect(await count()).toBe(before);
  });
});
