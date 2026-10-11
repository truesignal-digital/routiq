import {
  canReadLedger,
  FLEET_BOARD_DAYS,
  FLEET_USAGE_ROUTE_LIMIT,
  fleetUsageQuery,
  fleetUsageResponse,
  FUEL_OUTLIER_PERCENT,
  OFF_ROAD_MONTHS,
  TRIP_KM_RULE,
  type DailyStatus,
  type FleetUsageResponse,
  type FleetUsageRoute,
  type ModuleCode,
  type OverviewRange,
} from "@routiq/contracts";
import { and, asc, eq, inArray, isNotNull, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import {
  activities,
  activityAssetSegments,
  assetAvailabilityIntervals,
  assets,
  commands,
  financialEntries,
  financialPostings,
  movementLegs,
  places,
  workOrders,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { shiftMonth } from "./asset-finance.js";
import { addDays, currentBusinessDate, dayWindow } from "./business-date.js";
import { ANY_ROLE, defineRead } from "./define-read.js";
import { overviewWindows, postedLineConditions, vehicleExpenses, type DateWindow, type VehicleExpense } from "./finance-overview.js";
import { invalidRequest } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";
import { tripKm } from "./trip-km.js";
import { readableTripSql } from "./trip-scope.js";
import { dayStartSql, workspaceTimezone } from "./workspace-day.js";

/** No new operational records after these (§4.1): out of the fleet. */
const DISPOSED = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;

/** Work orders that hold the vehicle in the workshop, from creation until the completion is recorded. */
const WORKSHOP_STATUSES = ["APPROVED", "COMPLETION_SUBMITTED", "COMPLETED"] as const;

interface Vehicle {
  id: string;
  assetCode: string;
  registrationNumber: string | null;
  branchId: string;
  /** The first day ROUTIQ can say the vehicle was available; null when it never was commissioned. */
  knownFrom: string | null;
}

/** An interval as business dates, both inclusive; `to` null while it runs. */
interface DayInterval {
  assetId: string;
  from: string;
  to: string | null;
}

/** The fleet the read lists: active vehicles of the caller's branches, narrowed by `branchId`. */
async function loadVehicles(tx: TenantTx, auth: AuthContext, branchId: string | undefined, timezone: string): Promise<Vehicle[]> {
  const conditions: SQL[] = [eq(assets.workspaceId, auth.workspaceId), notInArray(assets.lifecycleStatus, [...DISPOSED])];
  if (auth.branchScope !== "ALL") conditions.push(inArray(assets.branchId, auth.branchScope));
  if (branchId !== undefined) conditions.push(eq(assets.branchId, branchId));
  const rows = await tx
    .select({
      id: assets.id,
      assetCode: assets.assetCode,
      registrationNumber: assets.registrationNumber,
      branchId: assets.branchId,
      lifecycleStatus: assets.lifecycleStatus,
      commissionedAt: assets.commissionedAt,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(asc(assets.assetCode), asc(assets.id));
  return rows.map((row) => ({
    id: row.id,
    assetCode: row.assetCode,
    registrationNumber: row.registrationNumber,
    branchId: row.branchId,
    // A vehicle never commissioned was never available; one in service with
    // no commissioning date on file is known from the day it was added.
    knownFrom:
      row.commissionedAt !== null
        ? currentBusinessDate(row.commissionedAt, timezone)
        : row.lifecycleStatus === "REGISTERED"
          ? null
          : currentBusinessDate(row.createdAt, timezone),
  }));
}

const toDay = (at: Date | null, timezone: string): string | null => (at === null ? null : currentBusinessDate(at, timezone));

/**
 * The three kinds of fact a day is judged from, for `vehicleIds`, overlapping
 * the days from `fromDay` to now. Each module's facts only while it is on.
 */
async function loadFacts(
  tx: TenantTx,
  workspaceId: string,
  modules: ReadonlySet<ModuleCode>,
  vehicleIds: string[],
  fromDay: string,
  timezone: string,
): Promise<{ trips: DayInterval[]; grounded: DayInterval[]; workshop: DayInterval[] }> {
  if (vehicleIds.length === 0) return { trips: [], grounded: [], workshop: [] };
  const since = dayStartSql(fromDay, timezone);

  const trips: DayInterval[] = [];
  if (modules.has("ACTIVITIES")) {
    // A segment still running ends now; on a closed trip it ends with the trip.
    const ended = sql<Date | null>`coalesce(${activityAssetSegments.endedAt}, case when ${activities.status} = 'CLOSED'
      then coalesce(${activities.endedAt}, ${activities.closedAt}) end)`.mapWith(activities.endedAt);
    const rows = await tx
      .select({ assetId: activityAssetSegments.assetId, startedAt: activityAssetSegments.startedAt, endedAt: ended })
      .from(activityAssetSegments)
      .innerJoin(
        activities,
        and(eq(activities.workspaceId, activityAssetSegments.workspaceId), eq(activities.id, activityAssetSegments.activityId)),
      )
      .where(
        and(
          eq(activityAssetSegments.workspaceId, workspaceId),
          inArray(activityAssetSegments.assetId, vehicleIds),
          inArray(activityAssetSegments.role, ["PRIMARY", "SUBSTITUTE"]),
          inArray(activities.status, ["OPEN", "CLOSED"]),
          sql`(${ended} is null or ${ended} >= ${since})`,
        ),
      );
    for (const row of rows) {
      trips.push({ assetId: row.assetId, from: toDay(row.startedAt, timezone)!, to: toDay(row.endedAt, timezone) });
    }
  }

  const grounded: DayInterval[] = [];
  const workshop: DayInterval[] = [];
  if (modules.has("MAINTENANCE")) {
    const intervals = await tx
      .select({
        assetId: assetAvailabilityIntervals.assetId,
        openedAt: assetAvailabilityIntervals.openedAt,
        closedAt: assetAvailabilityIntervals.closedAt,
      })
      .from(assetAvailabilityIntervals)
      .where(
        and(
          eq(assetAvailabilityIntervals.workspaceId, workspaceId),
          inArray(assetAvailabilityIntervals.assetId, vehicleIds),
          sql`(${assetAvailabilityIntervals.closedAt} is null or ${assetAvailabilityIntervals.closedAt} >= ${since})`,
        ),
      );
    for (const row of intervals) {
      grounded.push({ assetId: row.assetId, from: toDay(row.openedAt, timezone)!, to: toDay(row.closedAt, timezone) });
    }

    // A work order has no start column: it opens when the command that created it ran.
    const orders = await tx
      .select({ assetId: workOrders.assetId, createdAt: commands.executedAt, completedAt: workOrders.completedAt })
      .from(workOrders)
      .innerJoin(commands, eq(commands.id, workOrders.createdByCommandId))
      .where(
        and(
          eq(workOrders.workspaceId, workspaceId),
          inArray(workOrders.assetId, vehicleIds),
          inArray(workOrders.status, [...WORKSHOP_STATUSES]),
          sql`(${workOrders.completedAt} is null or ${workOrders.completedAt} >= ${since})`,
        ),
      );
    for (const row of orders) {
      workshop.push({ assetId: row.assetId, from: toDay(row.createdAt, timezone)!, to: toDay(row.completedAt, timezone) });
    }
  }
  return { trips, grounded, workshop };
}

/** The days from `from` to `to`, both inclusive. */
function daysBetweenInclusive(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * Each vehicle's status on each day from `fromDay` to `today`, most serious
 * fact first (DAILY_STATUSES). Without Trips no day can be called available.
 */
export function judgeDays(
  vehicles: readonly Pick<Vehicle, "id" | "knownFrom">[],
  facts: { trips: DayInterval[]; grounded: DayInterval[]; workshop: DayInterval[] },
  fromDay: string,
  today: string,
  tripsRecorded: boolean,
): Map<string, Map<string, DailyStatus>> {
  const mark = (intervals: DayInterval[]) => {
    const marked = new Map<string, Set<string>>();
    for (const interval of intervals) {
      const first = interval.from > fromDay ? interval.from : fromDay;
      const last = interval.to === null || interval.to > today ? today : interval.to;
      if (first > last) continue;
      const days = marked.get(interval.assetId) ?? new Set<string>();
      for (const day of daysBetweenInclusive(first, last)) days.add(day);
      marked.set(interval.assetId, days);
    }
    return marked;
  };
  const grounded = mark(facts.grounded);
  const workshop = mark(facts.workshop);
  const trips = mark(facts.trips);
  const allDays = daysBetweenInclusive(fromDay, today);

  const result = new Map<string, Map<string, DailyStatus>>();
  for (const vehicle of vehicles) {
    const days = new Map<string, DailyStatus>();
    for (const day of allDays) {
      let status: DailyStatus;
      if (grounded.get(vehicle.id)?.has(day)) status = "GROUNDED";
      else if (workshop.get(vehicle.id)?.has(day)) status = "WORKSHOP";
      else if (trips.get(vehicle.id)?.has(day)) status = "ON_TRIP";
      else if (!tripsRecorded || vehicle.knownFrom === null || day < vehicle.knownFrom) status = "NOT_RECORDED";
      else status = "AVAILABLE";
      days.set(day, status);
    }
    result.set(vehicle.id, days);
  }
  return result;
}

function onTheRoad(statuses: Map<string, Map<string, DailyStatus>>, days: readonly string[]) {
  let tripDays = 0;
  let recordedDays = 0;
  let notRecordedDays = 0;
  for (const byDay of statuses.values()) {
    for (const day of days) {
      const status = byDay.get(day);
      if (status === undefined || status === "NOT_RECORDED") notRecordedDays += 1;
      else {
        recordedDays += 1;
        if (status === "ON_TRIP") tripDays += 1;
      }
    }
  }
  return { tripDays, recordedDays, notRecordedDays };
}

/**
 * Trips closed inside `window` (by the workspace's day) in the caller's
 * branches, narrowed by `branchId`. `TRIPS` is the trips the caller may read
 * (`readableTripSql`: a driver's own); `VEHICLES` counts a vehicle's km by its
 * trips whoever drove them, as its status and the idle tile do, so a driver
 * never reads another truck's km as 0.
 */
function closedIn(
  auth: AuthContext,
  branchId: string | undefined,
  window: DateWindow,
  timezone: string,
  scope: "TRIPS" | "VEHICLES",
): SQL {
  const branches: SQL[] = [eq(activities.workspaceId, auth.workspaceId)];
  if (auth.branchScope !== "ALL") branches.push(inArray(activities.branchId, auth.branchScope));
  return and(
    scope === "TRIPS" ? readableTripSql(auth) : and(...branches)!,
    ...(branchId === undefined ? [] : [eq(activities.branchId, branchId)]),
    eq(activities.status, "CLOSED"),
    sql`${activities.closedAt} >= ${dayStartSql(window.from, timezone)}`,
    sql`${activities.closedAt} < ${dayStartSql(addDays(window.to, 1), timezone)}`,
  )!;
}

interface VehicleKm {
  km: number;
  known: boolean;
  tripsClosed: number;
  tripsFromOdometer: number;
  tripsWithoutKm: number;
}

/** Each vehicle's km over the trips closed in the window, by TRIP_KM_RULE. */
export async function vehicleKm(tx: TenantTx, workspaceId: string, trips: SQL): Promise<Map<string, VehicleKm>> {
  const byVehicle = new Map<string, VehicleKm>();
  for (const carried of (await tripKm(tx, workspaceId, trips)).carried) {
    const sums = byVehicle.get(carried.assetId) ?? { km: 0, known: true, tripsClosed: 0, tripsFromOdometer: 0, tripsWithoutKm: 0 };
    sums.tripsClosed += 1;
    if (carried.km === null) {
      sums.tripsWithoutKm += 1;
      sums.known = false;
    } else {
      sums.km += carried.km;
      if (carried.source === "ODOMETER") sums.tripsFromOdometer += 1;
    }
    byVehicle.set(carried.assetId, sums);
  }
  return byVehicle;
}

const NO_TRIPS: VehicleKm = { km: 0, known: true, tripsClosed: 0, tripsFromOdometer: 0, tripsWithoutKm: 0 };

/** Minor units per km, rounded to the nearest unit; null unless km are known, not zero, and money was recorded. */
export function perKm(amount: bigint, km: VehicleKm | undefined): bigint | null {
  if (km === undefined || !km.known || km.km <= 0 || amount <= 0n) return null;
  const kmBig = BigInt(km.km);
  return (amount * 2n + kmBig) / (2n * kmBig);
}

/** The middle value, or the rounded mean of the two middle values; null for none. */
export function median(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]! + 1n) / 2n;
}

/** Whole percent above the median when more than FUEL_OUTLIER_PERCENT; null otherwise. */
export function percentAbove(value: bigint | null, middle: bigint | null): number | null {
  if (value === null || middle === null || middle <= 0n || value <= middle) return null;
  const percent = Number(((value - middle) * 100n) / middle);
  return percent > FUEL_OUTLIER_PERCENT ? percent : null;
}

export interface FuelPerKmRow {
  assetId: string;
  fuelPerKm: bigint | null;
}

/** Fuel per km per vehicle and the fleet median: the money Overview's lines ÷ known km. */
export function fuelPerKmFigures(
  vehicleIds: readonly string[],
  km: Map<string, VehicleKm>,
  expenses: Map<string, VehicleExpense>,
): { rows: FuelPerKmRow[]; median: bigint | null } {
  const rows = vehicleIds.map((assetId) => ({
    assetId,
    fuelPerKm: perKm(expenses.get(assetId)?.fuel ?? 0n, km.get(assetId) ?? NO_TRIPS),
  }));
  return { rows, median: median(rows.flatMap((row) => (row.fuelPerKm === null ? [] : [row.fuelPerKm]))) };
}

async function workspaceCurrency(tx: TenantTx, workspaceId: string): Promise<string> {
  const [workspace] = await tx
    .select({ currency: workspaces.defaultCurrency })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return workspace?.currency ?? "XAF";
}

/**
 * The vehicles more than FUEL_OUTLIER_PERCENT above the fleet median fuel per
 * km this month, in the caller's whole Branch Scope (#668's To do rows):
 * the same km, lines and median the Money Overview's chart draws.
 */
export async function fuelOutliers(
  tx: TenantTx,
  auth: AuthContext,
  timezone: string,
): Promise<{ assetId: string; assetCode: string; branchId: string; fuelPerKm: bigint; median: bigint; percent: number; currency: string }[]> {
  const today = currentBusinessDate(new Date(), timezone);
  const { period } = overviewWindows(today, "THIS_MONTH");
  const vehicles = await loadVehicles(tx, auth, undefined, timezone);
  if (vehicles.length === 0) return [];
  const currency = await workspaceCurrency(tx, auth.workspaceId);
  const km = await vehicleKm(tx, auth.workspaceId, closedIn(auth, undefined, period, timezone, "VEHICLES"));
  const expenses = await vehicleExpenses(tx, auth, undefined, currency, period);
  const figures = fuelPerKmFigures(
    vehicles.map((vehicle) => vehicle.id),
    km,
    expenses,
  );
  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  return figures.rows.flatMap((row) => {
    const percent = percentAbove(row.fuelPerKm, figures.median);
    const vehicle = byId.get(row.assetId);
    if (percent === null || row.fuelPerKm === null || figures.median === null || vehicle === undefined) return [];
    return [
      {
        assetId: vehicle.id,
        assetCode: vehicle.assetCode,
        branchId: vehicle.branchId,
        fuelPerKm: row.fuelPerKm,
        median: figures.median,
        percent,
        currency,
      },
    ];
  });
}

/** Leg km by load state over the trips matching `trips`. */
async function loadKm(tx: TenantTx, trips: SQL) {
  const [row] = await tx
    .select({
      emptyKm: sql<number>`coalesce(sum(${movementLegs.distanceKm}) filter (where ${movementLegs.loadState} = 'EMPTY'), 0)::int`,
      loadedKm: sql<number>`coalesce(sum(${movementLegs.distanceKm}) filter (where ${movementLegs.loadState} in ('LADEN', 'PARTIAL')), 0)::int`,
      unknownLoadKm: sql<number>`coalesce(sum(${movementLegs.distanceKm}) filter (where ${movementLegs.loadState} is null), 0)::int`,
    })
    .from(movementLegs)
    .innerJoin(
      activities,
      and(eq(activities.workspaceId, movementLegs.workspaceId), eq(activities.id, movementLegs.activityId)),
    )
    .where(and(trips, isNotNull(movementLegs.distanceKm)));
  return { emptyKm: row?.emptyKm ?? 0, loadedKm: row?.loadedKm ?? 0, unknownLoadKm: row?.unknownLoadKm ?? 0 };
}

/**
 * Routes over the trips matching `trips`: each trip's first leg, either way
 * round, its km by TRIP_KM_RULE, and (with money) its posted revenue.
 */
async function loadRoutes(
  tx: TenantTx,
  auth: AuthContext,
  trips: SQL,
  money: { branchId: string | undefined; currency: string } | null,
): Promise<{ routes: FleetUsageRoute[]; otherRoutes: number; tripsWithoutRoute: number }> {
  const originPlace = alias(places, "origin_place");
  const destinationPlace = alias(places, "destination_place");
  const tripRows = await tx.select({ id: activities.id }).from(activities).where(trips);
  const firstLegs = await tx
    .selectDistinctOn([movementLegs.activityId], {
      tripId: movementLegs.activityId,
      origin: sql<string | null>`coalesce(${originPlace.name}, ${movementLegs.originText})`,
      destination: sql<string | null>`coalesce(${destinationPlace.name}, ${movementLegs.destinationText})`,
    })
    .from(movementLegs)
    .innerJoin(
      activities,
      and(eq(activities.workspaceId, movementLegs.workspaceId), eq(activities.id, movementLegs.activityId)),
    )
    .leftJoin(
      originPlace,
      and(eq(originPlace.workspaceId, movementLegs.workspaceId), eq(originPlace.id, movementLegs.originPlaceId)),
    )
    .leftJoin(
      destinationPlace,
      and(eq(destinationPlace.workspaceId, movementLegs.workspaceId), eq(destinationPlace.id, movementLegs.destinationPlaceId)),
    )
    .where(trips)
    .orderBy(movementLegs.activityId, movementLegs.legNo);
  const { trips: kmByTrip } = await tripKm(tx, auth.workspaceId, trips);

  const revenueByTrip = new Map<string, bigint>();
  const tripIds = firstLegs.map((leg) => leg.tripId);
  if (money !== null && tripIds.length > 0) {
    const { posted } = postedLineConditions(auth, money.branchId, money.currency);
    const rows = await tx
      .select({
        tripId: financialPostings.activityId,
        amountMinor: sql<string>`sum(${financialPostings.amountMinor})::text`,
      })
      .from(financialPostings)
      .innerJoin(
        financialEntries,
        and(
          eq(financialEntries.workspaceId, financialPostings.workspaceId),
          eq(financialEntries.id, financialPostings.financialEntryId),
        ),
      )
      .where(and(...posted, eq(financialEntries.direction, "REVENUE"), inArray(financialPostings.activityId, tripIds)))
      .groupBy(financialPostings.activityId);
    for (const row of rows) if (row.tripId !== null) revenueByTrip.set(row.tripId, BigInt(row.amountMinor));
  }

  const routes = new Map<string, { from: string; to: string; trips: number; tripsWithKm: number; km: number; revenue: bigint }>();
  let tripsWithoutRoute = tripRows.length - firstLegs.length;
  for (const leg of firstLegs) {
    const origin = leg.origin?.trim();
    const destination = leg.destination?.trim();
    if (!origin || !destination) {
      tripsWithoutRoute += 1;
      continue;
    }
    const [from, to] = [origin, destination].sort((a, b) => a.localeCompare(b, "fr")) as [string, string];
    const key = `${from.toLocaleLowerCase("fr")}|${to.toLocaleLowerCase("fr")}`;
    const route = routes.get(key) ?? { from, to, trips: 0, tripsWithKm: 0, km: 0, revenue: 0n };
    route.trips += 1;
    const km = kmByTrip.get(leg.tripId)?.km ?? null;
    if (km !== null) {
      route.tripsWithKm += 1;
      route.km += km;
      route.revenue += revenueByTrip.get(leg.tripId) ?? 0n;
    }
    routes.set(key, route);
  }
  const sorted = [...routes.entries()].sort(([keyA, a], [keyB, b]) => b.km - a.km || keyA.localeCompare(keyB));
  return {
    routes: sorted.slice(0, FLEET_USAGE_ROUTE_LIMIT).map(([key, route]) => ({
      key,
      from: route.from,
      to: route.to,
      trips: route.trips,
      tripsWithKm: route.tripsWithKm,
      km: route.km,
      revenueMinor: money === null ? null : serializeMinor(route.revenue),
      revenuePerKmMinor:
        money === null || route.km <= 0 || route.revenue <= 0n
          ? null
          : serializeMinor((route.revenue * 2n + BigInt(route.km)) / (2n * BigInt(route.km))),
    })),
    otherRoutes: Math.max(0, sorted.length - FLEET_USAGE_ROUTE_LIMIT),
    tripsWithoutRoute,
  };
}

async function loadUsage(
  tx: TenantTx,
  auth: AuthContext,
  modules: ReadonlySet<ModuleCode>,
  range: OverviewRange,
  branchId: string | undefined,
): Promise<FleetUsageResponse> {
  const timezone = await workspaceTimezone(tx, auth.workspaceId);
  const today = currentBusinessDate(new Date(), timezone);
  const { period, comparison } = overviewWindows(today, range);
  const tripsOn = modules.has("ACTIVITIES");
  const maintenanceOn = modules.has("MAINTENANCE");
  const moneyOn = tripsOn && modules.has("FINANCE") && canReadLedger(auth.role);

  const vehicles = await loadVehicles(tx, auth, branchId, timezone);
  const vehicleIds = vehicles.map((vehicle) => vehicle.id);

  const boardDays = dayWindow(today, FLEET_BOARD_DAYS);
  const previousDays = dayWindow(addDays(boardDays[0]!, -1), FLEET_BOARD_DAYS);
  const months = Array.from({ length: OFF_ROAD_MONTHS }, (_, i) => shiftMonth(today.slice(0, 7), i - OFF_ROAD_MONTHS + 1));
  const firstDay = [`${months[0]!}-01`, previousDays[0]!].sort()[0]!;

  const facts = await loadFacts(tx, auth.workspaceId, modules, vehicleIds, firstDay, timezone);
  const statuses = judgeDays(vehicles, facts, firstDay, today, tripsOn);

  const kmPeriod = tripsOn ? await vehicleKm(tx, auth.workspaceId, closedIn(auth, branchId, period, timezone, "VEHICLES")) : null;
  const kmComparison = tripsOn ? await vehicleKm(tx, auth.workspaceId, closedIn(auth, branchId, comparison, timezone, "VEHICLES")) : null;

  const currency = await workspaceCurrency(tx, auth.workspaceId);
  const expensesPeriod = moneyOn ? await vehicleExpenses(tx, auth, branchId, currency, period) : null;
  const expensesComparison = moneyOn ? await vehicleExpenses(tx, auth, branchId, currency, comparison) : null;

  const costPerKm = (expenses: Map<string, VehicleExpense>, km: Map<string, VehicleKm>, id: string) =>
    perKm(expenses.get(id)?.expense ?? 0n, km.get(id) ?? NO_TRIPS);
  const fuel =
    expensesPeriod !== null && kmPeriod !== null ? fuelPerKmFigures(vehicleIds, kmPeriod, expensesPeriod) : null;
  const fuelById = new Map(fuel?.rows.map((row) => [row.assetId, row.fuelPerKm]) ?? []);
  const costMedian =
    expensesPeriod !== null && kmPeriod !== null
      ? median(vehicleIds.flatMap((id) => {
          const value = costPerKm(expensesPeriod, kmPeriod, id);
          return value === null ? [] : [value];
        }))
      : null;

  const fleetCost = (expenses: Map<string, VehicleExpense>, km: Map<string, VehicleKm>) => {
    let expense = 0n;
    let knownKm = 0;
    let counted = 0;
    for (const id of vehicleIds) {
      if (costPerKm(expenses, km, id) === null) continue;
      expense += expenses.get(id)?.expense ?? 0n;
      knownKm += km.get(id)?.km ?? 0;
      counted += 1;
    }
    return {
      costPerKmMinor: knownKm <= 0 || expense <= 0n ? null : serializeMinor((expense * 2n + BigInt(knownKm)) / (2n * BigInt(knownKm))),
      expenseMinor: serializeMinor(expense),
      km: knownKm,
      vehicles: counted,
    };
  };

  const fleetKm = (km: Map<string, VehicleKm>) => {
    let knownVehicles = 0;
    let knownKm = 0;
    for (const id of vehicleIds) {
      const sums = km.get(id) ?? NO_TRIPS;
      if (!sums.known) continue;
      knownVehicles += 1;
      knownKm += sums.km;
    }
    return { vehicles: vehicleIds.length, knownVehicles, knownKm };
  };

  const tripsScope = (window: DateWindow) => closedIn(auth, branchId, window, timezone, "TRIPS");
  const routes = tripsOn
    ? await loadRoutes(tx, auth, tripsScope(period), moneyOn ? { branchId, currency } : null)
    : null;

  return {
    range,
    branchId: branchId ?? null,
    businessDate: today,
    period,
    comparison,
    kmRule: TRIP_KM_RULE,
    boardDays,
    vehicles: vehicles.map((vehicle) => {
      const byDay = statuses.get(vehicle.id);
      const money =
        expensesPeriod === null || kmPeriod === null
          ? null
          : (() => {
              const sums = expensesPeriod.get(vehicle.id) ?? { expense: 0n, fuel: 0n };
              const fuelPerKm = fuelById.get(vehicle.id) ?? null;
              const cost = costPerKm(expensesPeriod, kmPeriod, vehicle.id);
              return {
                expenseMinor: serializeMinor(sums.expense),
                fuelExpenseMinor: serializeMinor(sums.fuel),
                costPerKmMinor: cost === null ? null : serializeMinor(cost),
                fuelPerKmMinor: fuelPerKm === null ? null : serializeMinor(fuelPerKm),
                fuelAboveMedianPercent: percentAbove(fuelPerKm, fuel?.median ?? null),
              };
            })();
      return {
        assetId: vehicle.id,
        assetCode: vehicle.assetCode,
        registrationNumber: vehicle.registrationNumber,
        branchId: vehicle.branchId,
        days: boardDays.map((day) => byDay?.get(day) ?? "NOT_RECORDED"),
        period: kmPeriod === null ? null : { ...(kmPeriod.get(vehicle.id) ?? NO_TRIPS) },
        comparison: kmComparison === null ? null : { ...(kmComparison.get(vehicle.id) ?? NO_TRIPS) },
        money,
      };
    }),
    km: kmPeriod === null || kmComparison === null ? null : { period: fleetKm(kmPeriod), comparison: fleetKm(kmComparison) },
    onTheRoad: { last: onTheRoad(statuses, boardDays), previous: onTheRoad(statuses, previousDays) },
    offRoadByMonth: maintenanceOn
      ? months.map((periodCode) => {
          let days = 0;
          for (const byDay of statuses.values()) {
            for (const [day, status] of byDay) {
              if (day.startsWith(periodCode) && (status === "GROUNDED" || status === "WORKSHOP")) days += 1;
            }
          }
          return { periodCode, days, partial: periodCode === today.slice(0, 7) };
        })
      : null,
    money:
      expensesPeriod === null || expensesComparison === null || kmPeriod === null || kmComparison === null
        ? null
        : {
            currency,
            period: fleetCost(expensesPeriod, kmPeriod),
            comparison: fleetCost(expensesComparison, kmComparison),
            costPerKmMedianMinor: costMedian === null ? null : serializeMinor(costMedian),
            fuelPerKmMedianMinor: fuel?.median == null ? null : serializeMinor(fuel.median),
          },
    trips:
      routes === null
        ? null
        : {
            period: await loadKm(tx, tripsScope(period)),
            comparison: await loadKm(tx, tripsScope(comparison)),
            routes: routes.routes,
            otherRoutes: routes.otherRoutes,
            tripsWithoutRoute: routes.tripsWithoutRoute,
          },
  };
}

/**
 * `GET /v1/assets/usage` (#668): km, daily status and cost per km for every
 * vehicle the caller can see. Km and status for every role that reads
 * vehicles; the money-derived values (cost and fuel per km, revenue per km)
 * only for the roles that read vehicle money (`canReadLedger`, as the money
 * Overview's vehicle rows) with Money on. Rows stop at the caller's branches;
 * `branchId` narrows inside them.
 */
export function registerFleetUsageReadRoutes(app: FastifyInstance, db: Db, requireAuth: RequireAuth) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/assets/usage", module: "ASSETS", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, auth, modules, read }) => {
      const query = fleetUsageQuery.safeParse(req.query);
      if (!query.success) throw invalidRequest();
      const { range, branchId } = query.data;
      const body = await read((tx) => loadUsage(tx, auth, modules, range, branchId));
      return fleetUsageResponse.parse(body);
    },
  );
}
