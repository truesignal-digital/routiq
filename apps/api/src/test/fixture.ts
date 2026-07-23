import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { inject } from "vitest";
import * as schema from "../db/schema.js";
import { buildServer } from "../server.js";

/** Server + db handle against the suite-wide Testcontainers Postgres (see global-setup.ts). */
export async function createTestApp() {
  const pool = new pg.Pool({ connectionString: inject("databaseUrl") });
  const db = drizzle(pool, { schema });
  const app = buildServer({ db, logger: false });
  await app.ready();

  return {
    app,
    db,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
