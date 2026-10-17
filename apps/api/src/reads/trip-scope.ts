import { readsOwnTripsOnly } from "@routiq/contracts";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { AuthContext } from "../auth/types.js";
import { ownTripSql } from "../commands/own-records.js";
import { activities } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/**
 * The trips this caller may read, as a condition on an `activities` row: the
 * workspace, the caller's branches, then the role's trip scope
 * (`TRIP_READ_SCOPE`). A driver reads only their own trips, by the same
 * definition the commands act on (`ownTripSql`). Every read that returns
 * trips or a trip's records applies it, so a trip outside it answers exactly
 * like one that does not exist.
 */
export function readableTripSql(auth: AuthContext): SQL {
  const conditions: SQL[] = [eq(activities.workspaceId, auth.workspaceId)];
  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(activities.branchId, auth.branchScope));
  }
  if (readsOwnTripsOnly(auth.role)) conditions.push(ownTripSql(auth));
  return and(...conditions)!;
}

/** Whether the caller may read this one trip: `readableTripSql` for a single id. */
export async function canReadTrip(tx: TenantTx, auth: AuthContext, tripId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, tripId), readableTripSql(auth)))
    .limit(1);
  return row !== undefined;
}
