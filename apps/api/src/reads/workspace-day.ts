import { eq, sql, type SQL } from "drizzle-orm";
import { workspaces } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/**
 * Days are workspace days: trip filters, the week tile, trip numbers and
 * document expiry all cut at the workspace's midnight, never UTC's. Branches
 * carry their own zone too; nothing uses it yet, and moving one read alone
 * would split it from the others (#511).
 */
export async function workspaceTimezone(tx: TenantTx, workspaceId: string): Promise<string> {
  const [workspace] = await tx
    .select({ timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return workspace?.timezone ?? "Africa/Douala";
}

/** The instant a calendar day starts in `timezone`; the day is an ISO date or a date expression. */
export function dayStartSql(date: string | SQL, timezone: string): SQL {
  return sql`((${date})::date)::timestamp at time zone ${timezone}`;
}
