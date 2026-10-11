import { and, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { activities, activityAssetSegments, meterReadings, movementLegs } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/** Where a trip's km came from (TRIP_KM_RULE): its legs, else its odometer readings. */
export type KmSource = "LEGS" | "ODOMETER";

export interface CarriedKm {
  tripId: string;
  assetId: string;
  /** Null when neither the legs it ran nor its segment readings give km. */
  km: number | null;
  source: KmSource | null;
}

export interface TripKm {
  tripId: string;
  km: number | null;
  source: KmSource | null;
}

interface Reading {
  id: string;
  value: bigint;
  supersededById: string | null;
}

/**
 * The reading each one stands for now: corrections supersede, never edit
 * (§4.1), so follow `superseded_by_id` to the head of the chain.
 */
async function currentReadings(tx: TenantTx, workspaceId: string, found: Reading[]): Promise<Map<string, Reading>> {
  const rows = new Map(found.map((row) => [row.id, row]));
  let pending = found.map((row) => row.supersededById).filter((id): id is string => id !== null && !rows.has(id));
  // A correction chain is short; the bound only guards against a cycle.
  for (let depth = 0; pending.length > 0 && depth < 20; depth += 1) {
    const more = await tx
      .select({ id: meterReadings.id, value: meterReadings.value, supersededById: meterReadings.supersededById })
      .from(meterReadings)
      .where(and(eq(meterReadings.workspaceId, workspaceId), inArray(meterReadings.id, pending)));
    for (const row of more) rows.set(row.id, row);
    pending = more.map((row) => row.supersededById).filter((id): id is string => id !== null && !rows.has(id));
  }
  const heads = new Map<string, Reading>();
  for (const row of found) {
    let current = row;
    for (let hops = 0; current.supersededById !== null && hops < 20; hops += 1) {
      const next = rows.get(current.supersededById);
      if (next === undefined) break;
      current = next;
    }
    heads.set(row.id, current);
  }
  return heads;
}

/**
 * Km per trip and per carrier, by TRIP_KM_RULE, for the trips matching
 * `trips` (a condition on `activities`). A carrier is a PRIMARY or SUBSTITUTE
 * segment's vehicle.
 *
 * - Legs first: the km of the legs that record a distance. A leg counts for
 *   the vehicle of its segment, or the trip's first carrier when it names
 *   none, as the money Overview has always counted it.
 * - Else the odometer: the vehicle's odometer readings taken on the trip
 *   (recorded against it, or its segments' start and end readings), the
 *   highest less the lowest, after corrections. Two readings at least, of
 *   different values; otherwise the km are not known.
 * - The two are never added.
 */
export async function tripKm(
  tx: TenantTx,
  workspaceId: string,
  trips: SQL,
): Promise<{ carried: CarriedKm[]; trips: Map<string, TripKm> }> {
  const segmentJoin = and(
    eq(activityAssetSegments.workspaceId, activities.workspaceId),
    eq(activityAssetSegments.activityId, activities.id),
  );
  const segments = await tx
    .select({
      tripId: activities.id,
      segmentId: activityAssetSegments.id,
      assetId: activityAssetSegments.assetId,
      startReadingId: activityAssetSegments.startReadingId,
      endReadingId: activityAssetSegments.endReadingId,
    })
    .from(activities)
    .innerJoin(activityAssetSegments, segmentJoin)
    .where(and(trips, inArray(activityAssetSegments.role, ["PRIMARY", "SUBSTITUTE"])));

  const firstCarrier = sql<string | null>`(
    select ${activityAssetSegments.assetId} from ${activityAssetSegments}
    where ${activityAssetSegments.workspaceId} = ${activities.workspaceId}
      and ${activityAssetSegments.activityId} = ${activities.id}
      and ${activityAssetSegments.role} = 'PRIMARY'
    order by ${activityAssetSegments.startedAt}
    limit 1
  )`;
  const legRows = await tx
    .select({
      tripId: activities.id,
      assetId: sql<string | null>`coalesce((
        select ${activityAssetSegments.assetId} from ${activityAssetSegments}
        where ${activityAssetSegments.workspaceId} = ${movementLegs.workspaceId}
          and ${activityAssetSegments.id} = ${movementLegs.segmentId}
      ), ${firstCarrier})`,
      km: sql<number>`sum(${movementLegs.distanceKm})::int`,
    })
    .from(movementLegs)
    .innerJoin(
      activities,
      and(eq(activities.workspaceId, movementLegs.workspaceId), eq(activities.id, movementLegs.activityId)),
    )
    .where(and(trips, isNotNull(movementLegs.distanceKm)))
    .groupBy(sql`1`, sql`2`);

  // Odometer readings on these trips, by trip and vehicle: recorded against
  // the trip, or linked from a segment as its start or end.
  const tripIds = [...new Set(segments.map((segment) => segment.tripId))];
  const carrierIds = [...new Set(segments.map((segment) => segment.assetId))];
  const linked = new Map<string, string>();
  for (const segment of segments) {
    for (const id of [segment.startReadingId, segment.endReadingId]) {
      if (id !== null) linked.set(id, `${segment.tripId}:${segment.assetId}`);
    }
  }
  const readingRows =
    tripIds.length === 0
      ? []
      : await tx
          .select({
            id: meterReadings.id,
            assetId: meterReadings.assetId,
            activityId: meterReadings.activityId,
            value: meterReadings.value,
            supersededById: meterReadings.supersededById,
          })
          .from(meterReadings)
          .where(
            and(
              eq(meterReadings.workspaceId, workspaceId),
              eq(meterReadings.readingType, "ODOMETER"),
              inArray(meterReadings.assetId, carrierIds),
              linked.size === 0
                ? inArray(meterReadings.activityId, tripIds)
                : or(inArray(meterReadings.activityId, tripIds), inArray(meterReadings.id, [...linked.keys()])),
            ),
          );
  const heads = await currentReadings(tx, workspaceId, readingRows);
  const readingsByCarrier = new Map<string, Map<string, bigint>>();
  for (const row of readingRows) {
    const key = linked.get(row.id) ?? (row.activityId === null ? undefined : `${row.activityId}:${row.assetId}`);
    const head = heads.get(row.id);
    if (key === undefined || head === undefined) continue;
    const values = readingsByCarrier.get(key) ?? new Map<string, bigint>();
    values.set(head.id, head.value);
    readingsByCarrier.set(key, values);
  }
  const odometerKm = (key: string): number | null => {
    const values = [...(readingsByCarrier.get(key)?.values() ?? [])];
    if (values.length < 2) return null;
    const low = values.reduce((a, b) => (b < a ? b : a));
    const high = values.reduce((a, b) => (b > a ? b : a));
    return high > low ? Number(high - low) : null;
  };

  const legKm = new Map<string, number>();
  const tripLegKm = new Map<string, number>();
  for (const row of legRows) {
    tripLegKm.set(row.tripId, (tripLegKm.get(row.tripId) ?? 0) + row.km);
    if (row.assetId !== null) legKm.set(`${row.tripId}:${row.assetId}`, (legKm.get(`${row.tripId}:${row.assetId}`) ?? 0) + row.km);
  }

  const byCarrier = new Map<string, (typeof segments)[number][]>();
  const byTrip = new Map<string, (typeof segments)[number][]>();
  for (const segment of segments) {
    const key = `${segment.tripId}:${segment.assetId}`;
    byCarrier.set(key, [...(byCarrier.get(key) ?? []), segment]);
    byTrip.set(segment.tripId, [...(byTrip.get(segment.tripId) ?? []), segment]);
  }
  const carried: CarriedKm[] = [...byCarrier.entries()].map(([key, list]) => {
    const [first] = list;
    const tripId = first!.tripId;
    const assetId = first!.assetId;
    const legs = legKm.get(key);
    if (legs !== undefined) return { tripId, assetId, km: legs, source: "LEGS" };
    const fromOdometer = odometerKm(key);
    return { tripId, assetId, km: fromOdometer, source: fromOdometer === null ? null : "ODOMETER" };
  });

  const tripTotals = new Map<string, TripKm>();
  for (const [tripId, list] of byTrip) {
    const legs = tripLegKm.get(tripId);
    if (legs !== undefined) {
      tripTotals.set(tripId, { tripId, km: legs, source: "LEGS" });
      continue;
    }
    // Every carrier's odometer km, or none known.
    const perCarrier = [...new Set(list.map((segment) => segment.assetId))].map((assetId) => odometerKm(`${tripId}:${assetId}`));
    const fromOdometer = perCarrier.some((km) => km === null) ? null : perCarrier.reduce<number>((sum, km) => sum + (km ?? 0), 0);
    tripTotals.set(tripId, { tripId, km: fromOdometer, source: fromOdometer === null ? null : "ODOMETER" });
  }
  return { carried, trips: tripTotals };
}
