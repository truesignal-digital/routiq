import { eq, sql, type SQL } from "drizzle-orm";
import { workspaces } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/**
 * Days are workspace days (#511): trip filters, the week tile, trip numbers,
 * document expiry, the booking commands and the planning read all cut at the
 * workspace's midnight, never UTC's. Branches carry their own zone too;
 * nothing uses it yet, and moving one read alone would split it from the
 * others.
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

/**
 * The end of the business day holding `at`, in `timezone`: where a booking
 * with no planned end stops occupying its vehicle (ADR-0012 §4).
 */
export function endOfBusinessDaySql(at: SQL, timezone: string): SQL {
  return sql`(((${at}) at time zone ${timezone})::date + 1)::timestamp at time zone ${timezone}`;
}
