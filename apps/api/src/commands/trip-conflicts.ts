import {
  TRIP_CONFLICT_CODES,
  type CommandWarningMetadata,
  type TripConflictCode,
} from "@routiq/contracts";
import { sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  assetAvailabilityIntervals,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { endOfBusinessDaySql } from "../reads/workspace-day.js";

/** The `activities` columns these rules read, on the table or an alias of it. */
export type TripTable = Record<
  | "id"
  | "workspaceId"
  | "status"
  | "activityNumber"
  | "plannedStartAt"
  | "plannedEndAt"
  | "startedAt"
  | "endedAt"
  | "plannedAssetId"
  | "plannedDriverPersonId",
  AnyPgColumn
>;

/**
 * Where a trip sits in time (ADR-0012 §4), the one definition the booking
 * commands and the planning read share. PLANNED and CANCELLED: the planned
 * start. Started: the actual start.
 */
export function windowStartSql(trip: TripTable = activities): SQL<Date> {
  return sql<Date>`(CASE WHEN ${trip.status} IN ('PLANNED', 'CANCELLED')
    THEN ${trip.plannedStartAt} ELSE ${trip.startedAt} END)`;
}

/**
 * PLANNED and CANCELLED: the planned end, else the end of the planned start's
 * business day. OPEN: the later of the planned end and now. CLOSED: the end.
 * Never before the start, so the range is always valid.
 */
export function windowEndSql(timezone: string, trip: TripTable = activities): SQL<Date> {
  return sql<Date>`(CASE
    WHEN ${trip.status} IN ('PLANNED', 'CANCELLED') THEN COALESCE(
      ${trip.plannedEndAt},
      ${endOfBusinessDaySql(sql`${trip.plannedStartAt}`, timezone)})
    WHEN ${trip.status} = 'OPEN' THEN GREATEST(${trip.plannedEndAt}, now(), ${trip.startedAt})
    ELSE GREATEST(COALESCE(${trip.endedAt}, ${trip.startedAt}), ${trip.startedAt})
  END)`;
}

/** The booked window as a range: `[start, end)`. */
export function bookedWindowSql(timezone: string, trip: TripTable = activities): SQL {
  return sql`tstzrange(${windowStartSql(trip)}, ${windowEndSql(timezone, trip)}, '[)')`;
}

/** The vehicles a trip holds: the planned one while PLANNED, the open segments' once OPEN. */
function vehiclesOfSql(trip: TripTable): SQL {
  return sql`(
    SELECT ${trip.plannedAssetId}
    WHERE ${trip.status} = 'PLANNED' AND ${trip.plannedAssetId} IS NOT NULL
    UNION ALL
    SELECT ${activityAssetSegments.assetId} FROM ${activityAssetSegments}
    WHERE ${trip.status} = 'OPEN'
      AND ${activityAssetSegments.workspaceId} = ${trip.workspaceId}
      AND ${activityAssetSegments.activityId} = ${trip.id}
      AND ${activityAssetSegments.endedAt} IS NULL
  )`;
}

/** The drivers a trip holds: the planned one while PLANNED, the DRIVER crew once OPEN. */
function driversOfSql(trip: TripTable): SQL {
  return sql`(
    SELECT ${trip.plannedDriverPersonId}
    WHERE ${trip.status} = 'PLANNED' AND ${trip.plannedDriverPersonId} IS NOT NULL
    UNION ALL
    SELECT ${activityPeople.personId} FROM ${activityPeople}
    WHERE ${trip.status} = 'OPEN'
      AND ${activityPeople.workspaceId} = ${trip.workspaceId}
      AND ${activityPeople.activityId} = ${trip.id}
      AND ${activityPeople.role} = 'DRIVER'
  )`;
}

export interface TripConflicts {
  codes: TripConflictCode[];
  /** The other trips behind each double booking, by trip number. */
  tripIds: CommandWarningMetadata;
}

/**
 * The collisions of each PLANNED or OPEN trip (ADR-0012 §4), recomputed from
 * the current rows and never stored: its vehicle or driver on another
 * PLANNED or OPEN trip whose booked window overlaps, and its vehicle grounded
 * now (an open availability interval, only with MAINTENANCE on). The booking
 * commands return these as warnings; the planning read marks the board with
 * them. Trips in other statuses, or not found, have none.
 */
export async function tripConflicts(
  tx: TenantTx,
  scope: { workspaceId: string; timezone: string; maintenanceOn: boolean },
  tripIds: readonly string[],
): Promise<Map<string, TripConflicts>> {
  const result = new Map<string, TripConflicts>();
  if (tripIds.length === 0) return result;

  const subject = alias(activities, "conflict_subject");
  const other = alias(activities, "conflict_other");
  // Raw SQL with the aliases spelled out: a select list renders its columns
  // unqualified, which a correlated self-join cannot survive.
  const from = (name: string) => sql`${activities} AS ${sql.identifier(name)}`;
  const clashing = (holds: (trip: TripTable) => SQL): SQL => sql`array(
    SELECT ${other.id} FROM ${from("conflict_other")}
    WHERE ${other.workspaceId} = ${subject.workspaceId}
      AND ${other.id} <> ${subject.id}
      AND ${other.status} IN ('PLANNED', 'OPEN')
      AND ${bookedWindowSql(scope.timezone, other)} && ${bookedWindowSql(scope.timezone, subject)}
      AND EXISTS (SELECT 1 FROM ${holds(subject)} AS mine(id) WHERE mine.id IN ${holds(other)})
    ORDER BY ${other.activityNumber}, ${other.id}
  )`;
  const grounded = scope.maintenanceOn
    ? sql`EXISTS (
        SELECT 1 FROM ${assetAvailabilityIntervals}
        WHERE ${assetAvailabilityIntervals.workspaceId} = ${subject.workspaceId}
          AND ${assetAvailabilityIntervals.closedAt} IS NULL
          AND ${assetAvailabilityIntervals.assetId} IN ${vehiclesOfSql(subject)}
      )`
    : sql`false`;

  const query = await tx.execute(sql`
    SELECT ${subject.id} AS id,
      ${clashing(vehiclesOfSql)} AS vehicle_trip_ids,
      ${clashing(driversOfSql)} AS driver_trip_ids,
      ${grounded} AS grounded
    FROM ${from("conflict_subject")}
    WHERE ${subject.workspaceId} = ${scope.workspaceId}
      AND ${subject.id} IN ${sql`(${sql.join(tripIds.map((id) => sql`${id}::uuid`), sql`, `)})`}
      AND ${subject.status} IN ('PLANNED', 'OPEN')
  `);
  const rows = (query.rows as Array<{
    id: string;
    vehicle_trip_ids: string[];
    driver_trip_ids: string[];
    grounded: boolean;
  }>).map((row) => ({
    id: row.id,
    vehicleTripIds: row.vehicle_trip_ids,
    driverTripIds: row.driver_trip_ids,
    grounded: row.grounded,
  }));

  for (const row of rows) {
    const found: Record<TripConflictCode, boolean> = {
      VEHICLE_DOUBLE_BOOKED: row.vehicleTripIds.length > 0,
      VEHICLE_GROUNDED: row.grounded,
      DRIVER_DOUBLE_BOOKED: row.driverTripIds.length > 0,
    };
    const tripIdsByCode: CommandWarningMetadata = {};
    if (found.VEHICLE_DOUBLE_BOOKED) tripIdsByCode.VEHICLE_DOUBLE_BOOKED = { tripIds: row.vehicleTripIds };
    if (found.DRIVER_DOUBLE_BOOKED) tripIdsByCode.DRIVER_DOUBLE_BOOKED = { tripIds: row.driverTripIds };
    result.set(row.id, {
      codes: TRIP_CONFLICT_CODES.filter((code) => found[code]),
      tripIds: tripIdsByCode,
    });
  }
  return result;
}
