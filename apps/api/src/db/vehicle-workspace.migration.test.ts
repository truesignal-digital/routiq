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

/** The vehicle-workspace migrations (#44) and the command types each backfills. */
const VEHICLE_MIGRATIONS = [
  { file: "0028_notes.sql", commands: ["add-note"] },
  { file: "0029_attach_evidence_command_defaults.sql", commands: ["attach-evidence"] },
] as const;

const BACKFILLED_COMMANDS = VEHICLE_MIGRATIONS.flatMap((migration) => [...migration.commands]);

/**
 * The #44 migrations against a database that predates them: migrated to 0027
 * from a truncated journal, seeded with two tenants, then brought forward by
 * the real migrator — the path a deployed box takes. Its own database inside
 * the suite's container, so nothing here leaks into the shared one.
 */
describe("vehicle-workspace migrations on a database that predates them", () => {
  const databaseName = `pre0028_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;

  const ws = randomUUID();
  const bareWs = randomUUID();
  const otherWs = randomUUID();
  const branch = randomUUID();
  const otherBranch = randomUUID();
  const principal = randomUUID();
  const membership = randomUUID();
  const command = randomUUID();
  const otherCommand = randomUUID();
  const asset = randomUUID();
  const otherAsset = randomUUID();

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

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0028-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 27);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    await pool.query(`
      INSERT INTO workspaces (id, slug, name) VALUES
        ('${ws}', 'pre-0028-${ws.slice(0, 8)}', 'Transports Pré-0028'),
        ('${bareWs}', 'pre-0028-${bareWs.slice(0, 8)}', 'Atelier vierge'),
        ('${otherWs}', 'pre-0028-${otherWs.slice(0, 8)}', 'Voisin');
      INSERT INTO branches (id, workspace_id, code, name) VALUES
        ('${branch}', '${ws}', 'DLA', 'Douala'),
        ('${otherBranch}', '${otherWs}', 'DLA', 'Douala');
      INSERT INTO principals (id, principal_type, display_name) VALUES ('${principal}', 'HUMAN', 'Admin');
      INSERT INTO memberships (id, workspace_id, principal_id, role, all_branches) VALUES
        ('${membership}', '${ws}', '${principal}', 'ADMIN', true),
        ('${randomUUID()}', '${otherWs}', '${principal}', 'ADMIN', true);
      INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload) VALUES
        ('${command}', '${ws}', 'register-asset', 'HUMAN_UI', 'EXECUTED', '${principal}', 'seed-1', '{}'),
        ('${otherCommand}', '${otherWs}', 'register-asset', 'HUMAN_UI', 'EXECUTED', '${principal}', 'seed-2', '{}');
      INSERT INTO assets (id, workspace_id, branch_id, asset_code, asset_class_code, template_code, created_by_command_id) VALUES
        ('${asset}', '${ws}', '${branch}', 'TRK-001', 'TRUCK', 'TRUCKING', '${command}'),
        ('${otherAsset}', '${otherWs}', '${otherBranch}', 'TRK-001', 'TRUCK', 'TRUCKING', '${otherCommand}');
      -- A tenant that already held one of the new rules keeps exactly one.
      INSERT INTO approval_rules (workspace_id, command_type, required_role)
        VALUES ('${ws}', 'add-note', 'ADMIN');
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
      rules: await query<{ n: string }>(`SELECT count(*)::text AS n FROM approval_rules`),
      constraints: await query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'notes'::regclass ORDER BY conname`,
      ),
      indexes: await query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename IN ('notes', 'documents') ORDER BY indexname`,
      ),
      policies: await query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'notes'`,
      ),
    };
  }

  it("backfills the new commands' rules exactly as a new workspace is provisioned", async () => {
    for (const workspaceId of [ws, bareWs]) {
      const backfilled = (
        await query<{ command_type: string; required_role: string }>(
          `SELECT command_type, required_role FROM approval_rules
           WHERE workspace_id = $1 AND command_type = ANY($2)`,
          [workspaceId, BACKFILLED_COMMANDS],
        )
      )
        .map((rule) => `${rule.command_type}:${rule.required_role}`)
        .sort();
      const provisioned = corePack.approvalRules
        .filter((rule) => (BACKFILLED_COMMANDS as readonly string[]).includes(rule.commandType))
        .map((rule) => `${rule.commandType}:${rule.requiredRole}`)
        .sort();
      expect(backfilled).toEqual(provisioned);
      expect(backfilled).not.toContain("add-note:EXECUTIVE_VIEWER");
      expect(backfilled).not.toContain("attach-evidence:EXECUTIVE_VIEWER");
      expect(backfilled).toContain("attach-evidence:MAINTENANCE");
    }
  });

  it("creates notes behind forced RLS, with the runtime role limited to read and append", async () => {
    expect(
      await query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'notes'`,
      ),
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const privileges = await query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'routiq_app' AND table_name = 'notes' ORDER BY privilege_type`,
    );
    expect(privileges.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });

  it("keeps an asset note's arc and tenant structural", async () => {
    const insert = (values: { assetId: string | null; entityId: string; workspaceId?: string }) =>
      pool.query(
        `INSERT INTO notes (id, workspace_id, entity_type, entity_id, asset_id, author_membership_id, body, created_by_command_id)
         VALUES ($1, $2, 'asset', $3, $4, $5, 'x', $6)`,
        [randomUUID(), values.workspaceId ?? ws, values.entityId, values.assetId, membership, command],
      );

    await expect(insert({ assetId: null, entityId: asset })).rejects.toMatchObject({
      constraint: "notes_asset_arc_ck",
    });
    await expect(insert({ assetId: asset, entityId: randomUUID() })).rejects.toMatchObject({
      constraint: "notes_asset_arc_ck",
    });
    // Another tenant's truck: the composite FK refuses it whatever the ids say.
    await expect(insert({ assetId: otherAsset, entityId: otherAsset })).rejects.toMatchObject({
      constraint: "notes_ws_asset_fk",
    });
    await expect(insert({ assetId: asset, entityId: asset })).resolves.toBeDefined();
  });

  it("finds nothing to do on a second run", async () => {
    const before = await snapshot();
    for (const { file } of VEHICLE_MIGRATIONS) {
      const statements = (await readFile(join(MIGRATIONS, file), "utf8"))
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      for (const statement of statements) {
        await pool.query(statement);
      }
    }
    expect(await snapshot()).toEqual(before);
    const applied = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(Number(applied[0]?.n)).toBe(28 + VEHICLE_MIGRATIONS.length);
  });
});
