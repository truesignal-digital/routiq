import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env["DATABASE_URL"] ?? "postgres://asset:asset@localhost:5435/asset_dev";

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
