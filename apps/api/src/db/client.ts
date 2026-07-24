import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env["DATABASE_URL"] ?? "postgres://routiq:routiq@localhost:5435/routiq_dev";

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
