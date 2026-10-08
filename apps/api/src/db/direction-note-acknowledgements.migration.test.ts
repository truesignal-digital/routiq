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
const TAG_SUFFIX = "_direction_note_acknowledgements";

/**
 * The Direction-notes migration (#98) on a workspace that predates it: notes
 * already written take their author's role, and every role may acknowledge.
 * Located by tag, so a renumber does not break it. Its own database inside the
 * suite's container (guard T1).
 */
describe("direction note acknowledgements migration", () => {
  const databaseName = `prenote_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;
  const ws = randomUUID();
  const branch = randomUUID();
  const asset = randomUUID();
  const command = randomUUID();
  const directorPrincipal = randomUUID();
  const driverPrincipal = randomUUID();
  const director = randomUUID();
  const driver = randomUUID();
  const directorNote = randomUUID();
  const driverNote = randomUUID();

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

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-prenote-"));
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

    await pool.query(`
      INSERT INTO workspaces (id, slug, name) VALUES ('${ws}', 'prenote-${ws.slice(0, 8)}', 'Avant les notes');
      INSERT INTO branches (id, workspace_id, code, name) VALUES ('${branch}', '${ws}', 'DLA', 'Douala');
      INSERT INTO principals (id, principal_type, display_name) VALUES
        ('${directorPrincipal}', 'HUMAN', 'Émilienne'),
        ('${driverPrincipal}', 'HUMAN', 'Sali');
      INSERT INTO memberships (id, workspace_id, principal_id, role, all_branches) VALUES
        ('${director}', '${ws}', '${directorPrincipal}', 'DIRECTOR', true),
        ('${driver}', '${ws}', '${driverPrincipal}', 'DRIVER', true);
      INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload) VALUES
        ('${command}', '${ws}', 'register-asset', 'HUMAN_UI', 'EXECUTED', '${directorPrincipal}', 'seed-1', '{}');
      INSERT INTO assets (id, workspace_id, branch_id, asset_code, asset_class_code, template_code, created_by_command_id) VALUES
        ('${asset}', '${ws}', '${branch}', 'TRK-001', 'TRUCK', 'TRUCKING', '${command}');
      INSERT INTO notes (id, workspace_id, entity_type, entity_id, asset_id, author_membership_id, body, created_by_command_id) VALUES
        ('${directorNote}', '${ws}', 'asset', '${asset}', '${asset}', '${director}', 'Pourquoi si cher ?', '${command}'),
        ('${driverNote}', '${ws}', 'asset', '${asset}', '${asset}', '${driver}', 'Pneu usé', '${command}');
    `);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  it("gives every existing note its author's role", async () => {
    const rows = await query<{ id: string; author_role: string }>(
      `SELECT id, author_role FROM notes WHERE workspace_id = $1 ORDER BY author_role`,
      [ws],
    );
    expect(rows).toEqual([
      { id: directorNote, author_role: "DIRECTOR" },
      { id: driverNote, author_role: "DRIVER" },
    ]);
  });

  it("refuses a note without a known role from now on", async () => {
    await expect(
      pool.query(
        `INSERT INTO notes (id, workspace_id, entity_type, entity_id, asset_id, author_membership_id, author_role, body, created_by_command_id)
         VALUES ($1, $2, 'asset', $3, $3, $4, 'BOSS', 'x', $5)`,
        [randomUUID(), ws, asset, director, command],
      ),
    ).rejects.toMatchObject({ constraint: "notes_author_role_ck" });
  });

  it("lets every role acknowledge, as a new workspace's catalog does", async () => {
    const rows = await query<{ required_role: string }>(
      `SELECT required_role FROM approval_rules
       WHERE workspace_id = $1 AND command_type = 'acknowledge-note'
         AND category_code IS NULL AND branch_id IS NULL
         AND amount_min_minor IS NULL AND amount_max_minor IS NULL`,
      [ws],
    );
    const catalog = corePack.approvalRules
      .filter((rule) => rule.commandType === "acknowledge-note")
      .map((rule) => rule.requiredRole)
      .sort();
    expect(rows.map((row) => row.required_role).sort()).toEqual(catalog);
    expect(catalog).toHaveLength(6);
  });

  it("keeps one acknowledgement per note, inside its own workspace", async () => {
    const ack = (id = randomUUID()) =>
      pool.query(
        `INSERT INTO note_acknowledgements (id, workspace_id, note_id, membership_id, created_by_command_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, ws, directorNote, driver, command],
      );
    await expect(ack()).resolves.toBeDefined();
    await expect(ack()).rejects.toMatchObject({ constraint: "note_acknowledgements_ws_note_uq" });
  });
});
