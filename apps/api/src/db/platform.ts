import type { Db } from "./client.js";
import type { TenantTx } from "./tenant.js";

/**
 * The RLS-bypassing connection, wrapped so it is not structurally a `Db`.
 *
 * Platform-scope commands cannot run under `inWorkspace`: they create the
 * workspace their rows belong to, so there is no id to put in the
 * `app.workspace_id` GUC when the transaction opens. That exception is confined
 * by the type rather than by convention — every workspace-scope entry point
 * takes a `Db`, and a `PlatformDb` is not one, so no tenant code path can be
 * handed the bypass client by accident. Unwrapping is possible but has to be
 * written down.
 */
export interface PlatformDb {
  readonly bypassRls: Db;
}

/** Marks a connection as the platform escape hatch. CLI and tests only — never a request path. */
export function platformDb(db: Db): PlatformDb {
  return { bypassRls: db };
}

/** A transaction with no workspace GUC: the workspace is what the command is about to write. */
export function inPlatformScope<T>(
  db: PlatformDb,
  execute: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.bypassRls.transaction(execute);
}
