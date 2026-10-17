import {
  planningQuery,
  planningResponse,
  type ActivityStatus,
  type PlanningDay,
  type PlanningTrip,
  type PlanningVehicle,
  type TripCancellationReason,
  type TripDiscrepancyCode,
} from "@routiq/contracts";
import { and, asc, eq, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  assetAvailabilityIntervals,
  assets,
  auditEvents,
  branches,
  categories,
  persons,
  principals,
  workOrders,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { tripConflicts, windowEndSql, windowStartSql } from "../commands/trip-conflicts.js";
import { legEndSql } from "./activities.js";
import { addDays } from "./business-date.js";
import { defineRead } from "./define-read.js";
import { notFound, invalidRequest, ReadRefusal } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";
import {
  cancellationOf,
  plannedRouteEndSql,
  tripPrices,
  tripPricesVisible,
} from "./trip-plan.js";
import { dayStartSql, workspaceTimezone } from "./workspace-day.js";

/** ADR-0012 §7: the people who plan, and those who work around the plan. Not the counter, not drivers. */
export const PLANNING_ROLES = ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN"] as const;

const DISPOSED = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;
const LIVE_WORK_ORDER = ["SUBMITTED", "APPROVED", "COMPLETION_SUBMITTED"] as const;

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

/** A filter id outside the caller's workspace or branches answers like one that does not exist. */
async function assertInScope(
  tx: TenantTx,
  auth: AuthContext,
  filters: { branchId?: string | undefined; assetId?: string | undefined; personId?: string | undefined },
): Promise<void> {
  const inBranches = (branchId: string) => auth.branchScope === "ALL" || auth.branchScope.includes(branchId);
  if (filters.branchId !== undefined) {
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.workspaceId, auth.workspaceId), eq(branches.id, filters.branchId)));
    if (!branch || !inBranches(branch.id)) throw notFound();
  }
  if (filters.assetId !== undefined) {
    const [asset] = await tx
      .select({ branchId: assets.branchId })
      .from(assets)
      .where(and(eq(assets.workspaceId, auth.workspaceId), eq(assets.id, filters.assetId)));
    if (!asset || !inBranches(asset.branchId)) throw notFound();
  }
  if (filters.personId !== undefined) {
    const [person] = await tx
      .select({ branchId: persons.branchId })
      .from(persons)
      .where(and(eq(persons.workspaceId, auth.workspaceId), eq(persons.id, filters.personId)));
    if (!person || !inBranches(person.branchId)) throw notFound();
  }
}

/** The vehicle on the trip: the planned one until it starts, then the latest carrying segment's. */
function vehicleSql(): SQL<{ id: string; assetCode: string; planned: boolean } | null> {
  return sql`(CASE WHEN ${activities.status} IN ('PLANNED', 'CANCELLED') THEN (
      SELECT json_build_object('id', ${assets.id}, 'assetCode', ${assets.assetCode}, 'planned', true)
      FROM ${assets}
      WHERE ${assets.workspaceId} = ${activities.workspaceId} AND ${assets.id} = ${activities.plannedAssetId}
    ) ELSE (
      SELECT json_build_object('id', ${assets.id}, 'assetCode', ${assets.assetCode}, 'planned', false)
      FROM ${activityAssetSegments}
      INNER JOIN ${assets}
        ON ${assets.workspaceId} = ${activityAssetSegments.workspaceId}
        AND ${assets.id} = ${activityAssetSegments.assetId}
      WHERE ${activityAssetSegments.workspaceId} = ${activities.workspaceId}
        AND ${activityAssetSegments.activityId} = ${activities.id}
        AND ${activityAssetSegments.role} IN ('PRIMARY', 'SUBSTITUTE')
      ORDER BY ${activityAssetSegments.startedAt} DESC, ${activityAssetSegments.id} DESC
      LIMIT 1
    ) END)`;
}

/** The driver: the planned one until the trip starts, then the first DRIVER on the crew, as the trip list names it. */
function driverSql(): SQL<{ personId: string; displayName: string; planned: boolean } | null> {
  return sql`(CASE WHEN ${activities.status} IN ('PLANNED', 'CANCELLED') THEN (
      SELECT json_build_object('personId', ${persons.id}, 'displayName', ${persons.displayName}, 'planned', true)
      FROM ${persons}
      WHERE ${persons.workspaceId} = ${activities.workspaceId} AND ${persons.id} = ${activities.plannedDriverPersonId}
    ) ELSE (
      SELECT json_build_object('personId', ${persons.id}, 'displayName', ${persons.displayName}, 'planned', false)
      FROM ${activityPeople}
      INNER JOIN ${persons}
        ON ${persons.workspaceId} = ${activityPeople.workspaceId}
        AND ${persons.id} = ${activityPeople.personId}
      WHERE ${activityPeople.workspaceId} = ${activities.workspaceId}
        AND ${activityPeople.activityId} = ${activities.id}
        AND ${activityPeople.role} = 'DRIVER'
      ORDER BY ${activityPeople.createdAt} ASC, ${persons.displayName} ASC, ${activityPeople.id} ASC
      LIMIT 1
    ) END)`;
}

/** One end of the route: the legs once there are any, else the plan. */
function routeEndSql(end: "origin" | "destination"): SQL<string | null> {
  return sql<string | null>`coalesce(${legEndSql(end)}, ${plannedRouteEndSql(end)})`;
}

/** The first event of `types` on the trip (or the last), with who did it. */
function auditActorSql(eventTypes: readonly string[], order: "first" | "last"): SQL<{
  displayName: string | null;
  at: string;
  eventType: string;
} | null> {
  return sql`(
    SELECT json_build_object(
      'displayName', ${principals.displayName},
      'at', ${auditEvents.occurredAt},
      'eventType', ${auditEvents.eventType})
    FROM ${auditEvents}
    LEFT JOIN ${principals} ON ${principals.id} = ${auditEvents.tenantActorPrincipalId}
    WHERE ${auditEvents.workspaceId} = ${activities.workspaceId}
      AND ${auditEvents.entityType} = 'activity'
      AND ${auditEvents.entityId} = ${activities.id}
      AND ${inArray(auditEvents.eventType, [...eventTypes])}
    ORDER BY ${auditEvents.occurredAt} ${order === "first" ? sql`ASC` : sql`DESC`}, ${auditEvents.id}
    LIMIT 1
  )`;
}

/**
 * `GET /v1/planning` (ADR-0012 §7, #336): the trips, vehicles and drivers a
 * planning board needs for a range of business days, with the per-day and
 * range counts computed here so the browser never counts rows.
 */
export function registerPlanningReadRoutes(app: FastifyInstance, db: Db, requireAuth: RequireAuth) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/planning", module: "SCHEDULING", roles: PLANNING_ROLES, branchScope: "per-record" },
    async ({ req, auth, modules, read }) => {
      // Scheduling depends on Activities; both must be on.
      if (!modules.has("ACTIVITIES")) {
        throw new ReadRefusal(403, "MODULE_DISABLED", { module: "ACTIVITIES" });
      }
      const parsed = planningQuery.safeParse(req.query);
      if (!parsed.success) throw invalidRequest();
      const query = parsed.data;
      const pricesVisible = tripPricesVisible(auth, modules);
      const maintenanceOn = modules.has("MAINTENANCE");

      const result = await read(async (tx) => {
        await assertInScope(tx, auth, query);
        const timezone = await workspaceTimezone(tx, auth.workspaceId);
        const [workspace] = await tx
          .select({ currency: workspaces.defaultCurrency })
          .from(workspaces)
          .where(eq(workspaces.id, auth.workspaceId));
        const currency = workspace?.currency ?? "XAF";

        const rangeStart = dayStartSql(query.from, timezone);
        const rangeEnd = dayStartSql(addDays(query.to, 1), timezone);
        const windowStart = windowStartSql();
        const windowEnd = windowEndSql(timezone);

        const statuses: ActivityStatus[] = ["PLANNED", "OPEN", "CLOSED"];
        if (query.includeCancelled === true) statuses.push("CANCELLED");
        const conditions: SQL[] = [
          eq(activities.workspaceId, auth.workspaceId),
          inArray(activities.status, statuses),
          // Overlaps the range; a zero-length window counts where it starts.
          sql`${windowStart} < ${rangeEnd}`,
          sql`(${windowEnd} > ${rangeStart} OR ${windowStart} >= ${rangeStart})`,
        ];
        if (auth.branchScope !== "ALL") conditions.push(inArray(activities.branchId, auth.branchScope));
        if (query.branchId !== undefined) conditions.push(eq(activities.branchId, query.branchId));
        if (query.customer !== undefined) {
          conditions.push(ilike(activities.customerName, likePattern(query.customer)));
        }
        if (query.assetId !== undefined) {
          conditions.push(
            or(
              eq(activities.plannedAssetId, query.assetId),
              sql`EXISTS (SELECT 1 FROM ${activityAssetSegments}
                WHERE ${activityAssetSegments.workspaceId} = ${activities.workspaceId}
                  AND ${activityAssetSegments.activityId} = ${activities.id}
                  AND ${activityAssetSegments.assetId} = ${query.assetId})`,
            )!,
          );
        }
        if (query.personId !== undefined) {
          conditions.push(
            or(
              eq(activities.plannedDriverPersonId, query.personId),
              sql`EXISTS (SELECT 1 FROM ${activityPeople}
                WHERE ${activityPeople.workspaceId} = ${activities.workspaceId}
                  AND ${activityPeople.activityId} = ${activities.id}
                  AND ${activityPeople.role} = 'DRIVER'
                  AND ${activityPeople.personId} = ${query.personId})`,
            )!,
          );
        }

        // Joined to the trip type, so every column below renders qualified.
        const tripRows = await tx
          .select({
            id: activities.id,
            activityNumber: activities.activityNumber,
            status: activities.status,
            templateCode: activities.templateCode,
            activityTypeCode: categories.code,
            activityTypeLabelFr: categories.labelFr,
            activityTypeLabelEn: categories.labelEn,
            branchId: activities.branchId,
            customerName: activities.customerName,
            clientReference: activities.clientReference,
            description: activities.description,
            plannedStartAt: activities.plannedStartAt,
            plannedEndAt: activities.plannedEndAt,
            startedAt: activities.startedAt,
            endedAt: activities.endedAt,
            windowStart: sql<Date>`${windowStart}`.mapWith(activities.startedAt),
            windowEnd: sql<Date>`${windowEnd}`.mapWith(activities.startedAt),
            originName: routeEndSql("origin"),
            destinationName: routeEndSql("destination"),
            vehicle: vehicleSql(),
            driver: driverSql(),
            discrepancyCodes: activities.discrepancyCodes,
            plannedBy: auditActorSql(["activity.planned"], "first"),
            lastChange: auditActorSql(["activity.assigned", "activity.rescheduled"], "last"),
            cancelledAt: activities.cancelledAt,
            cancellationReason: activities.cancellationReason,
            cancellationNote: activities.cancellationNote,
            priceCurrency: activities.priceCurrency,
            agreedPriceMinor: activities.agreedPriceMinor,
            amountToCollectMinor: activities.amountToCollectMinor,
          })
          .from(activities)
          .innerJoin(
            categories,
            and(
              eq(categories.workspaceId, activities.workspaceId),
              eq(categories.id, activities.activityTypeId),
            ),
          )
          .where(and(...conditions))
          .orderBy(sql`${windowStart}`, asc(activities.activityNumber), asc(activities.id));

        const conflicts = await tripConflicts(
          tx,
          { workspaceId: auth.workspaceId, timezone, maintenanceOn },
          tripRows.filter((row) => row.status === "PLANNED" || row.status === "OPEN").map((row) => row.id),
        );

        const vehicleConditions: SQL[] = [
          eq(assets.workspaceId, auth.workspaceId),
          notInArray(assets.lifecycleStatus, [...DISPOSED]),
        ];
        if (auth.branchScope !== "ALL") vehicleConditions.push(inArray(assets.branchId, auth.branchScope));
        if (query.branchId !== undefined) vehicleConditions.push(eq(assets.branchId, query.branchId));
        if (query.assetId !== undefined) vehicleConditions.push(eq(assets.id, query.assetId));
        const vehicleRows = await tx
          .select({
            id: assets.id,
            assetCode: assets.assetCode,
            registrationNumber: assets.registrationNumber,
            branchId: assets.branchId,
          })
          .from(assets)
          .where(and(...vehicleConditions))
          .orderBy(asc(assets.assetCode), asc(assets.id));

        const blockRows =
          maintenanceOn && vehicleRows.length > 0
            ? await tx
                .select({
                  id: assetAvailabilityIntervals.id,
                  assetId: assetAvailabilityIntervals.assetId,
                  from: assetAvailabilityIntervals.openedAt,
                  to: assetAvailabilityIntervals.closedAt,
                  issueId: assetAvailabilityIntervals.openedByIssueId,
                  workOrderId: sql<string | null>`(
                    SELECT ${workOrders.id} FROM ${workOrders}
                    WHERE ${workOrders.workspaceId} = ${assetAvailabilityIntervals.workspaceId}
                      AND ${workOrders.issueId} = ${assetAvailabilityIntervals.openedByIssueId}
                    ORDER BY (${inArray(workOrders.status, [...LIVE_WORK_ORDER])}) DESC,
                      ${workOrders.completedAt} DESC NULLS FIRST, ${workOrders.id}
                    LIMIT 1
                  )`,
                })
                .from(assetAvailabilityIntervals)
                .innerJoin(
                  assets,
                  and(
                    eq(assets.workspaceId, assetAvailabilityIntervals.workspaceId),
                    eq(assets.id, assetAvailabilityIntervals.assetId),
                  ),
                )
                .where(
                  and(
                    eq(assetAvailabilityIntervals.workspaceId, auth.workspaceId),
                    inArray(
                      assetAvailabilityIntervals.assetId,
                      vehicleRows.map((row) => row.id),
                    ),
                    sql`${assetAvailabilityIntervals.openedAt} < ${rangeEnd}`,
                    sql`(${assetAvailabilityIntervals.closedAt} IS NULL OR ${assetAvailabilityIntervals.closedAt} > ${rangeStart})`,
                  ),
                )
                .orderBy(asc(assetAvailabilityIntervals.openedAt), asc(assetAvailabilityIntervals.id))
            : [];

        const driverConditions: SQL[] = [
          eq(persons.workspaceId, auth.workspaceId),
          eq(persons.active, true),
          eq(persons.defaultRole, "DRIVER"),
        ];
        if (auth.branchScope !== "ALL") driverConditions.push(inArray(persons.branchId, auth.branchScope));
        if (query.branchId !== undefined) driverConditions.push(eq(persons.branchId, query.branchId));
        if (query.personId !== undefined) driverConditions.push(eq(persons.id, query.personId));
        const drivers = await tx
          .select({
            personId: persons.id,
            displayName: persons.displayName,
            personCode: persons.personCode,
            branchId: persons.branchId,
          })
          .from(persons)
          .where(and(...driverConditions))
          .orderBy(asc(persons.displayName), asc(persons.id));

        // Day edges are local midnights in the workspace zone.
        const dayEdges = await tx.execute(sql`
          SELECT d::date::text AS date,
            (d::date)::timestamp AT TIME ZONE ${timezone} AS starts_at,
            (d::date + 1)::timestamp AT TIME ZONE ${timezone} AS ends_at
          FROM generate_series(${query.from}::date, ${query.to}::date, interval '1 day') AS d
          ORDER BY d
        `);

        return { timezone, currency, tripRows, conflicts, vehicleRows, blockRows, drivers, dayEdges };
      });

      const trips: PlanningTrip[] = result.tripRows.map((row) => ({
        id: row.id,
        activityNumber: row.activityNumber,
        status: row.status,
        templateCode: row.templateCode,
        activityType: {
          code: row.activityTypeCode,
          labelFr: row.activityTypeLabelFr,
          labelEn: row.activityTypeLabelEn,
        },
        branchId: row.branchId,
        customerName: row.customerName,
        clientReference: row.clientReference,
        description: row.description,
        plannedStartAt: row.plannedStartAt?.toISOString() ?? null,
        plannedEndAt: row.plannedEndAt?.toISOString() ?? null,
        startedAt: row.startedAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        window: { start: iso(row.windowStart), end: iso(row.windowEnd) },
        originName: row.originName,
        destinationName: row.destinationName,
        vehicle: row.vehicle,
        driver: row.driver,
        conflicts: result.conflicts.get(row.id)?.codes ?? [],
        discrepancyCodes: row.discrepancyCodes as TripDiscrepancyCode[],
        plannedBy:
          row.plannedBy === null ? null : { displayName: row.plannedBy.displayName, at: iso(row.plannedBy.at) },
        lastChange:
          row.lastChange === null
            ? null
            : {
                kind: row.lastChange.eventType === "activity.assigned" ? "ASSIGNED" : "RESCHEDULED",
                displayName: row.lastChange.displayName,
                at: iso(row.lastChange.at),
              },
        cancellation: cancellationOf({
          cancelledAt: row.cancelledAt,
          cancellationReason: row.cancellationReason as TripCancellationReason | null,
          cancellationNote: row.cancellationNote,
        }),
        priceCurrency: row.priceCurrency,
        ...tripPrices(pricesVisible, row),
      }));

      const vehicles: PlanningVehicle[] = result.vehicleRows.map((vehicle) => ({
        ...vehicle,
        blocks: maintenanceOn
          ? result.blockRows
              .filter((block) => block.assetId === vehicle.id)
              .map((block) => ({
                id: block.id,
                from: block.from.toISOString(),
                to: block.to?.toISOString() ?? null,
                issueId: block.issueId,
                workOrderId: block.workOrderId,
              }))
          : null,
      }));

      const live = trips.filter((trip) => trip.status === "PLANNED" || trip.status === "OPEN");
      const planned = trips.filter((trip) => trip.status === "PLANNED");
      const toAssign = (trip: PlanningTrip) => trip.vehicle === null || trip.driver === null;
      const conflicted = (trip: PlanningTrip) => trip.conflicts.length > 0;

      const edges = result.dayEdges.rows as Array<{ date: string; starts_at: string | Date; ends_at: string | Date }>;
      const days: PlanningDay[] = edges.map((edge) => {
        const dayStart = new Date(edge.starts_at).getTime();
        const dayEnd = new Date(edge.ends_at).getTime();
        const onDay = (trip: PlanningTrip) => {
          const start = Date.parse(trip.window.start);
          const end = Date.parse(trip.window.end);
          return start < dayEnd && (end > dayStart || start >= dayStart);
        };
        const plannedOnDay = planned.filter(onDay);
        return {
          date: edge.date,
          planned: plannedOnDay.length,
          toAssign: plannedOnDay.filter(toAssign).length,
          conflicts: live.filter(onDay).filter(conflicted).length,
        };
      });

      const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
      const booked = new Set(
        live.flatMap((trip) => (trip.vehicle !== null && vehicleIds.has(trip.vehicle.id) ? [trip.vehicle.id] : [])),
      );
      const plannedRevenue = result.tripRows
        .filter((row) => row.status === "PLANNED" && row.priceCurrency === result.currency)
        .reduce((sum, row) => sum + (row.agreedPriceMinor ?? 0n), 0n);

      return planningResponse.parse({
        range: { from: query.from, to: query.to, timezone: result.timezone },
        trips,
        vehicles,
        drivers: result.drivers,
        days,
        summary: {
          planned: planned.length,
          toAssign: planned.filter(toAssign).length,
          conflicts: live.filter(conflicted).length,
          vehiclesBooked: booked.size,
          vehiclesTotal: vehicles.length,
          currency: result.currency,
          ...(pricesVisible ? { plannedRevenueMinor: serializeMinor(plannedRevenue) } : {}),
        },
      });
    },
  );
}
