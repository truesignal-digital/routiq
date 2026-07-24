import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { inject } from "vitest";
import * as schema from "../db/schema.js";
import { buildServer } from "../server.js";

/** Server + db handle against the suite-wide Testcontainers Postgres (see global-setup.ts). */
export async function createTestApp() {
  const ownerConnectionString = inject("databaseUrl");
  const runtimeUrl = new URL(ownerConnectionString);
  runtimeUrl.username = "routiq_app";
  runtimeUrl.password = "routiq_app";

  const ownerPool = new pg.Pool({ connectionString: ownerConnectionString });
  const runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString() });
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
    },
  };
}
