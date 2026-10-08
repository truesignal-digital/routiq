import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { inject } from "vitest";
import * as schema from "../db/schema.js";
import { buildServer } from "../server.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * A freshly migrated database of its own inside the suite's container. Test
 * files run in parallel against one shared database, so a file that runs SQL
 * over every workspace (a migration backfill) changes rows other files are
 * asserting on, and theirs change its (#104).
 */
async function createIsolatedDatabase(suiteUrl: string) {
  const name = `isolated_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const adminPool = new pg.Pool({ connectionString: suiteUrl });
  await adminPool.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  const url = new URL(suiteUrl);
  url.pathname = `/${name}`;
  const migrationPool = new pg.Pool({ connectionString: url.toString() });
  try {
    await migrate(drizzle(migrationPool), { migrationsFolder: MIGRATIONS });
  } finally {
    await migrationPool.end();
  }
  return {
    url: url.toString(),
    async drop() {
      await adminPool.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`);
      await adminPool.end();
    },
  };
}

/**
 * Server + db handle against the suite-wide Testcontainers Postgres (see
 * global-setup.ts). `isolated: true` gives the file its own database instead;
 * use it when a test runs SQL that touches every workspace.
 */
export async function createTestApp(options: { isolated?: boolean } = {}) {
  const suiteUrl = inject("databaseUrl");
  const isolated = options.isolated === true ? await createIsolatedDatabase(suiteUrl) : undefined;
  const ownerConnectionString = isolated?.url ?? suiteUrl;
  const runtimeUrl = new URL(ownerConnectionString);
  runtimeUrl.username = "routiq_app";
  runtimeUrl.password = "routiq_app";

  const ownerPool = new pg.Pool({ connectionString: ownerConnectionString });
  const runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString() });
  // The forced DROP DATABASE can reach a client that pool.end() is still
  // closing; pg-pool re-emits that FATAL, and it is expected there.
  if (isolated !== undefined) {
    ownerPool.on("error", () => {});
    runtimePool.on("error", () => {});
  }
  const db = drizzle(ownerPool, { schema });
  const runtimeDb = drizzle(runtimePool, { schema });
  const app = buildServer({ db: runtimeDb, authDb: db, logger: false });
  await app.ready();

  return {
    app,
    db,
    runtimeDb,
    async close() {
      await app.close();
      await runtimePool.end();
      await ownerPool.end();
      await isolated?.drop();
    },
  };
}
