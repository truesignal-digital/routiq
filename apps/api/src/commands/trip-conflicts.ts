import {
  TRIP_CONFLICT_CODES,
  type CommandWarningMetadata,
  type TripConflictCode,
} from "@routiq/contracts";
import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
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
  /** The other trips holding one of this trip's vehicles, the same list as VEHICLE_DOUBLE_BOOKED's. */
  vehicleTripIds: string[];
  /** The other trips holding one of this trip's drivers, the same list as DRIVER_DOUBLE_BOOKED's. */
  driverTripIds: string[];
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
      vehicleTripIds: row.vehicleTripIds,
      driverTripIds: row.driverTripIds,
    });
  }
  return result;
}

/**
 * The warnings a live or replayed start returns (ADR-0012 §4, #577, #653):
 * planning's rules for the started trip, plus any other OPEN trip still
 * holding its vehicle on an open segment or its driver in the DRIVER crew,
 * whatever the windows say (a phone clock running fast stamps a start ahead
 * of now(), which the window rule would miss). VEHICLE_DOUBLE_BOOKED and
 * DRIVER_DOUBLE_BOOKED name the other trips; VEHICLE_GROUNDED only with
 * MAINTENANCE on. A start is a fact, so it is never refused for these. Run
 * after the trip is OPEN with its segment and crew.
 */
export async function startedTripWarnings(
  tx: TenantTx,
  scope: { workspaceId: string; timezone: string; maintenanceOn: boolean },
  tripId: string,
): Promise<{ warnings: TripConflictCode[]; warningMetadata?: CommandWarningMetadata }> {
  const conflicts = (await tripConflicts(tx, scope, [tripId])).get(tripId);

  const mineSegment = alias(activityAssetSegments, "started_segment");
  const theirSegment = alias(activityAssetSegments, "other_segment");
  const vehicleHolders = await tx
    .selectDistinct({ id: theirSegment.activityId })
    .from(theirSegment)
    .innerJoin(
      activities,
      and(eq(activities.workspaceId, theirSegment.workspaceId), eq(activities.id, theirSegment.activityId)),
    )
    .innerJoin(
      mineSegment,
      and(eq(mineSegment.workspaceId, theirSegment.workspaceId), eq(mineSegment.assetId, theirSegment.assetId)),
    )
    .where(
      and(
        eq(theirSegment.workspaceId, scope.workspaceId),
        eq(mineSegment.activityId, tripId),
        isNull(mineSegment.endedAt),
        isNull(theirSegment.endedAt),
        ne(theirSegment.activityId, tripId),
        eq(activities.status, "OPEN"),
      ),
    );

  const mineCrew = alias(activityPeople, "started_crew");
  const theirCrew = alias(activityPeople, "other_crew");
  const driverHolders = await tx
    .selectDistinct({ id: theirCrew.activityId })
    .from(theirCrew)
    .innerJoin(
      activities,
      and(eq(activities.workspaceId, theirCrew.workspaceId), eq(activities.id, theirCrew.activityId)),
    )
    .innerJoin(
      mineCrew,
      and(eq(mineCrew.workspaceId, theirCrew.workspaceId), eq(mineCrew.personId, theirCrew.personId)),
    )
    .where(
      and(
        eq(theirCrew.workspaceId, scope.workspaceId),
        eq(mineCrew.activityId, tripId),
        eq(mineCrew.role, "DRIVER"),
        eq(theirCrew.role, "DRIVER"),
        ne(theirCrew.activityId, tripId),
        eq(activities.status, "OPEN"),
      ),
    );

  const union = (listed: readonly string[], holding: ReadonlyArray<{ id: string }>) => [
    ...new Set([...listed, ...holding.map((row) => row.id)]),
  ];
  const tripIdsByCode: Partial<Record<TripConflictCode, string[]>> = {
    VEHICLE_DOUBLE_BOOKED: union(conflicts?.vehicleTripIds ?? [], vehicleHolders),
    DRIVER_DOUBLE_BOOKED: union(conflicts?.driverTripIds ?? [], driverHolders),
  };
  const warnings = TRIP_CONFLICT_CODES.filter((code) =>
    code === "VEHICLE_GROUNDED"
      ? (conflicts?.codes.includes(code) ?? false)
      : (tripIdsByCode[code]?.length ?? 0) > 0,
  );
  const warningMetadata: CommandWarningMetadata = {};
  for (const code of warnings) {
    const tripIds = tripIdsByCode[code];
    if (tripIds !== undefined) warningMetadata[code] = { tripIds };
  }
  return Object.keys(warningMetadata).length > 0 ? { warnings, warningMetadata } : { warnings };
}
