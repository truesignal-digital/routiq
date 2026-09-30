import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Run tenant data access with a pool-safe, transaction-local RLS context. */
export function inWorkspace<T>(
  db: Db,
  workspaceId: string,
  execute: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.workspace_id', ${workspaceId}, true)`,
    );
    return execute(tx);
  });
}

/**
 * The same RLS context in a READ ONLY transaction: Postgres refuses any write
 * inside it, so a read route cannot become a second write path (§5).
 */
export function inWorkspaceRead<T>(
  db: Db,
  workspaceId: string,
  execute: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select set_config('app.workspace_id', ${workspaceId}, true)`,
      );
      return execute(tx);
    },
    { accessMode: "read only" },
  );
}
