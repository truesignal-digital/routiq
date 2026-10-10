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
const MIGRATION_0049 = join(MIGRATIONS, "0049_document_types_visite_carte_grise.sql");
const NEW_TYPES = ["CARTE_GRISE", "VISITE_TECHNIQUE"];

type DocumentType = { code: string; label_fr: string; label_en: string; active: boolean };

/**
 * 0049 against workspaces provisioned before it, the path a deployed box
 * takes: migrated to 0048 from a truncated journal, seeded, then brought
 * forward by the real migrator. Its own database inside the suite's container
 * (guard T1): the backfill writes to every workspace, and the shared database
 * holds other files' workspaces.
 */
describe("migration 0049 on workspaces that predate it", () => {
  const databaseName = `pre0049_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;
  let secondRun: { before: unknown; after: unknown };

  const ws = randomUUID();
  const ownWs = randomUUID();
  const namedWs = randomUUID();

  async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await pool.query(text, values)).rows as T[];
  }

  const documentTypes = (workspaceId: string) =>
    query<DocumentType>(
      `SELECT code, label_fr, label_en, active FROM categories
       WHERE workspace_id = $1 AND kind = 'DOCUMENT_TYPE' ORDER BY code`,
      [workspaceId],
    );

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    // The forced DROP DATABASE in afterAll can reach a client mid-close.
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0049-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 48);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    // One workspace with the old pack's types, one that already defined the
    // CARTE_GRISE code itself and switched it off, and one that filed both
    // papers under codes of its own, as the demo seed did before #661.
    await pool.query(`
      INSERT INTO workspaces (id, slug, name) VALUES
        ('${ws}', 'pre-0049-${ws.slice(0, 8)}', 'Transports Pré-0049'),
        ('${ownWs}', 'pre-0049-${ownWs.slice(0, 8)}', 'Flotte maison'),
        ('${namedWs}', 'pre-0049-${namedWs.slice(0, 8)}', 'Transports Ngwa');
      INSERT INTO categories (workspace_id, kind, code, label_fr, label_en) VALUES
        ('${namedWs}', 'DOCUMENT_TYPE', 'TECHNICAL_INSPECTION', 'Visite technique', 'Technical inspection'),
        ('${namedWs}', 'DOCUMENT_TYPE', 'REGISTRATION', 'Carte Grise ', 'Registration');
      INSERT INTO categories (workspace_id, kind, code, label_fr, label_en) VALUES
        ('${ws}', 'DOCUMENT_TYPE', 'INSURANCE', 'Assurance', 'Insurance'),
        ('${ws}', 'DOCUMENT_TYPE', 'PERMIT', 'Permis', 'Permit');
      INSERT INTO categories (workspace_id, kind, code, label_fr, label_en, active) VALUES
        ('${ownWs}', 'DOCUMENT_TYPE', 'CARTE_GRISE', 'Certificat d''immatriculation', 'Registration', false);
    `);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });

    const before = await query(`SELECT workspace_id, kind, code, label_fr, active FROM categories ORDER BY 1, 2, 3`);
    const statements = (await readFile(MIGRATION_0049, "utf8"))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await pool.query(statement);
    secondRun = {
      before,
      after: await query(`SELECT workspace_id, kind, code, label_fr, active FROM categories ORDER BY 1, 2, 3`),
    };
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  it("gives an existing workspace the two types exactly as a new workspace is provisioned", async () => {
    const provisioned = corePack.categories
      .filter((category) => category.kind === "DOCUMENT_TYPE" && NEW_TYPES.includes(category.code))
      .map((category) => ({
        code: category.code,
        label_fr: category.labelFr,
        label_en: category.labelEn,
        active: category.active ?? true,
      }))
      .sort((left, right) => left.code.localeCompare(right.code));
    expect(provisioned.map((type) => type.code)).toEqual(NEW_TYPES);

    const types = await documentTypes(ws);
    expect(types.map((type) => type.code)).toEqual(["CARTE_GRISE", "INSURANCE", "PERMIT", "VISITE_TECHNIQUE"]);
    expect(types.filter((type) => NEW_TYPES.includes(type.code))).toEqual(provisioned);
  });

  it("keeps a workspace's own row for a code it already defined", async () => {
    expect(await documentTypes(ownWs)).toEqual([
      { code: "CARTE_GRISE", label_fr: "Certificat d'immatriculation", label_en: "Registration", active: false },
      { code: "VISITE_TECHNIQUE", label_fr: "Visite technique", label_en: "Visite technique", active: true },
    ]);
  });

  it("adds no second type to a workspace that already files the paper under its own code", async () => {
    expect((await documentTypes(namedWs)).map((type) => type.code)).toEqual(["REGISTRATION", "TECHNICAL_INSPECTION"]);
  });

  it("finds nothing to do on a second run", () => {
    expect(secondRun.after).toEqual(secondRun.before);
  });
});
