import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { expect, inject, it } from "vitest";
import { corePack } from "../provisioning/packs/core.js";

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
}

it(
  "upgrades a pre-finance workspace without inventing custom category layers",
  async () => {
    const databaseUrl = inject("databaseUrl");
    const databaseName = `routiq_upgrade_${randomUUID().replaceAll("-", "")}`;
    const adminPool = new pg.Pool({ connectionString: databaseUrl });
    const partialMigrations = await migrationFolderThrough(9);
    let upgradePool: pg.Pool | undefined;

    try {
      await adminPool.query(`create database "${databaseName}"`);
      const upgradeUrl = new URL(databaseUrl);
      upgradeUrl.pathname = `/${databaseName}`;
      upgradePool = new pg.Pool({ connectionString: upgradeUrl.toString() });

      await migrate(drizzle(upgradePool), {
        migrationsFolder: partialMigrations,
      });

      const workspaceId = randomUUID();
      await upgradePool.query(
        "insert into workspaces (id, slug, name) values ($1, $2, $3)",
        [workspaceId, `upgrade-${workspaceId}`, "Upgrade test"],
      );
      await upgradePool.query(
        `insert into categories
          (workspace_id, kind, code, label_fr, label_en, profitability_layer)
         values
          ($1, 'EXPENSE_CATEGORY', 'LEGACY_CUSTOM', 'Personnalisé', 'Custom', null),
          ($1, 'EXPENSE_CATEGORY', 'FUEL', 'Ancien carburant', 'Legacy fuel', null)`,
        [workspaceId],
      );

      await migrate(drizzle(upgradePool), {
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle", import.meta.url),
        ),
      });

      const categories = await upgradePool.query<{
        code: string;
        profitability_layer: string | null;
        active: boolean;
      }>(
        `select code, profitability_layer, active
         from categories
         where workspace_id = $1
           and kind in ('EXPENSE_CATEGORY', 'REVENUE_CATEGORY')
         order by code`,
        [workspaceId],
      );
      expect(categories.rows).toHaveLength(8);
      expect(
        categories.rows.find((row) => row.code === "FUEL"),
      ).toMatchObject({ profitability_layer: "DIRECT" });
      expect(
        categories.rows.find((row) => row.code === "LEGACY_CUSTOM"),
      ).toMatchObject({ profitability_layer: null, active: false });

      const rules = await upgradePool.query(
        `select 1
         from approval_rules
         where workspace_id = $1 and command_type = 'record-expense'`,
        [workspaceId],
      );
      // 0012's bands and unbounded approver rules and 0027's workshop band,
      // put through 0036's role map: what a new workspace gets, six roles
      // banded and FINANCE, ADMIN and DIRECTOR unbounded.
      expect(rules.rows).toHaveLength(
        corePack.approvalRules.filter((rule) => rule.commandType === "record-expense").length,
      );
      expect(rules.rows).toHaveLength(9);

      const [constraint] = (
        await upgradePool.query<{ convalidated: boolean }>(
          `select convalidated
           from pg_constraint
           where conname = 'categories_profitability_layer_ck'`,
        )
      ).rows;
      expect(constraint?.convalidated).toBe(false);
    } finally {
      await upgradePool?.end();
      await adminPool.query(
        `select pg_terminate_backend(pid)
         from pg_stat_activity
         where datname = $1 and pid <> pg_backend_pid()`,
        [databaseName],
      );
      await adminPool.query(`drop database if exists "${databaseName}"`);
      await adminPool.end();
      await rm(partialMigrations, { recursive: true, force: true });
    }
  },
  20_000,
);

async function migrationFolderThrough(maxIndex: number): Promise<string> {
  const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
  const target = await mkdtemp(join(tmpdir(), "routiq-migrations-"));
  const metaTarget = join(target, "meta");
  await mkdir(metaTarget);

  const journal = JSON.parse(
    await readFile(join(source, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  await writeFile(
    join(metaTarget, "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  await Promise.all(
    entries.map((entry) =>
      copyFile(
        join(source, `${entry.tag}.sql`),
        join(target, `${entry.tag}.sql`),
      ),
    ),
  );
  return target;
}
