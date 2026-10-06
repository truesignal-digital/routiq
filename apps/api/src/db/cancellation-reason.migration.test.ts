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
 * 0040 (#426) on a database whose reversals were written by reverse-entry.v1:
 * each becomes an OTHER cancellation carrying the free text its audit event
 * kept, and the reason is then as immutable as the rest of the row.
 */
describe("0040 cancellation reasons on reversals that predate them", () => {
  const databaseName = `pre0040_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;

  const ws = randomUUID();
  const branch = randomUUID();
  const principal = randomUUID();
  const category = randomUUID();
  const recordCommand = randomUUID();
  const reverseCommand = randomUUID();
  const original = randomUUID();
  const reversal = randomUUID();
  const plain = randomUUID();

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0040-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 39);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    const entry = (id: string, number: string, amount: number, status: string, reverses: string | null, command: string) => `
      INSERT INTO financial_entries (id, workspace_id, entry_number, direction, category_id, economic_date, branch_id,
        amount_minor, payment_method, status, reverses_entry_id, created_by_command_id)
      VALUES ('${id}', '${ws}', '${number}', 'EXPENSE', '${category}', '2026-09-15', '${branch}',
        ${amount}, 'CASH', '${status}', ${reverses === null ? "NULL" : `'${reverses}'`}, '${command}');
      INSERT INTO financial_postings (id, workspace_id, financial_entry_id, line_no, economic_date, direction,
        category_id, branch_id, amount_minor, created_by_command_id)
      VALUES ('${randomUUID()}', '${ws}', '${id}', 1, '2026-09-15', 'EXPENSE', '${category}', '${branch}', ${amount}, '${command}');`;

    await pool.query(`
      BEGIN;
      INSERT INTO workspaces (id, slug, name) VALUES ('${ws}', 'pre-0040-${ws.slice(0, 8)}', 'Transports Pré-0040');
      INSERT INTO branches (id, workspace_id, code, name) VALUES ('${branch}', '${ws}', 'DLA', 'Douala');
      INSERT INTO principals (id, principal_type, display_name) VALUES ('${principal}', 'HUMAN', 'Nadège');
      INSERT INTO memberships (id, workspace_id, principal_id, role, all_branches) VALUES ('${randomUUID()}', '${ws}', '${principal}', 'FINANCE', true);
      INSERT INTO categories (id, workspace_id, kind, code, label_fr, label_en, profitability_layer)
        VALUES ('${category}', '${ws}', 'EXPENSE_CATEGORY', 'FUEL', 'Carburant', 'Fuel', 'DIRECT');
      INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload) VALUES
        ('${recordCommand}', '${ws}', 'record-expense', 'HUMAN_UI', 'EXECUTED', '${principal}', 'seed-1', '{}'),
        ('${reverseCommand}', '${ws}', 'reverse-entry', 'HUMAN_UI', 'EXECUTED', '${principal}', 'seed-2', '{}');
      ${entry(original, "DLA-2026-00001", 25000, "REVERSED", null, recordCommand)}
      ${entry(reversal, "DLA-2026-00002", -25000, "POSTED", original, reverseCommand)}
      ${entry(plain, "DLA-2026-00003", 9000, "POSTED", null, recordCommand)}
      INSERT INTO audit_events (workspace_id, command_id, actor_principal_id, event_type, entity_type, entity_id, after_state) VALUES
        ('${ws}', '${reverseCommand}', '${principal}', 'financial_entry.reversal_posted', 'financial_entry', '${reversal}',
         '{"reason": "Saisie en double", "reversesEntryId": "${original}"}');
      COMMIT;
    `);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  async function reasonOf(id: string) {
    const { rows } = await pool.query<{ code: string | null; text: string | null }>(
      `SELECT reversal_reason_code AS code, reversal_reason_text AS text FROM financial_entries WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  it("turns a v1 reversal into an OTHER cancellation with its audited text", async () => {
    expect(await reasonOf(reversal)).toEqual({ code: "OTHER", text: "Saisie en double" });
  });

  it("leaves entries that are not cancellations without a reason", async () => {
    expect(await reasonOf(original)).toEqual({ code: null, text: null });
    expect(await reasonOf(plain)).toEqual({ code: null, text: null });
  });

  it("refuses a reason on an entry that cancels nothing", async () => {
    await expect(
      pool.query(`UPDATE financial_entries SET reversal_reason_code = 'OTHER' WHERE id = $1`, [plain]),
    ).rejects.toThrow();
  });

  it("never lets a cancellation's reason change", async () => {
    await expect(
      pool.query(`UPDATE financial_entries SET reversal_reason_code = 'ENTERED_TWICE' WHERE id = $1`, [reversal]),
    ).rejects.toThrow(/immutable/);
  });
});
