import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const runtimeConnectionString =
  process.env["DATABASE_URL"] ??
  "postgres://routiq_app:routiq_app@localhost:5435/routiq_dev";
const authConnectionString =
  process.env["AUTH_DATABASE_URL"] ??
  "postgres://routiq:routiq@localhost:5435/routiq_dev";

/**
 * An idle client dropped by the server (e.g. Postgres restart, 57P01) emits
 * 'error' on the pool; unhandled, that kills the process. The pool discards
 * the client and reconnects on the next query, so logging is enough. Log the
 * code and message only — never the connection string.
 */
function logIdleClientErrors(name: string, target: pg.Pool): pg.Pool {
  target.on("error", (error: Error & { code?: string }) => {
    console.error(`[db] ${name} pool idle client error`, {
      code: error.code,
      message: error.message,
    });
  });
  return target;
}

export const pool = logIdleClientErrors(
  "runtime",
  new pg.Pool({ connectionString: runtimeConnectionString }),
);
export const db = drizzle(pool, { schema });
export const authPool = logIdleClientErrors(
  "auth",
  new pg.Pool({ connectionString: authConnectionString }),
);
export const authDb = drizzle(authPool, { schema });
export type Db = typeof db;
