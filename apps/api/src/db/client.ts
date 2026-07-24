import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const runtimeConnectionString =
  process.env["DATABASE_URL"] ??
  "postgres://routiq_app:routiq_app@localhost:5435/routiq_dev";
const authConnectionString =
  process.env["AUTH_DATABASE_URL"] ??
  "postgres://routiq:routiq@localhost:5435/routiq_dev";

export const pool = new pg.Pool({ connectionString: runtimeConnectionString });
export const db = drizzle(pool, { schema });
export const authPool = new pg.Pool({ connectionString: authConnectionString });
export const authDb = drizzle(authPool, { schema });
export type Db = typeof db;
