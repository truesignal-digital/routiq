import { eq, sql, type SQL } from "drizzle-orm";
import { workspaces } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/**
 * Business days are workspace days (#511): a trip started at 00:30 in Douala
 * belongs to that Douala day, not the UTC one. The trips list, its summary,
 * the booking commands and the planning read all cut days here. Branches
 * carry their own zone too; none of these reads uses it yet, and moving one
 * alone would split a tile from the list it filters.
 */
export async function workspaceTimezone(tx: TenantTx, workspaceId: string): Promise<string> {
  const [workspace] = await tx
    .select({ timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return workspace?.timezone ?? "Africa/Douala";
}

/** The instant a calendar day starts in `timezone`. */
export function dayStartSql(isoDate: string, timezone: string): SQL {
  return sql`(${isoDate}::date)::timestamp at time zone ${timezone}`;
}

/**
 * The end of the business day holding `at`, in `timezone`: where a booking
 * with no planned end stops occupying its vehicle (ADR-0012 §4).
 */
export function endOfBusinessDaySql(at: SQL, timezone: string): SQL {
  return sql`(((${at}) at time zone ${timezone})::date + 1)::timestamp at time zone ${timezone}`;
}
