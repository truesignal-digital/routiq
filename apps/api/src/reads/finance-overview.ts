import {
  canReadLedger,
  financeOverviewQuery,
  financeOverviewResponse,
  ledgerEntryStatuses,
  MONEY_OVERVIEW_READER_ROLES,
  OVERVIEW_SERIES_MONTHS,
  type FinanceOverviewResponse,
  type OverviewCompanyProfit,
  type OverviewRange,
} from "@routiq/contracts";
import { and, eq, gte, inArray, isNotNull, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import {
  activities,
  activityAssetSegments,
  assets,
  branches,
  categories,
  financialEntries,
  financialPostings,
  movementLegs,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { shiftMonth } from "./asset-finance.js";
import { addDays, currentBusinessDate } from "./business-date.js";
import { defineRead } from "./define-read.js";
import { entryEvidenceMissingSql } from "./entry-evidence.js";
import { monthBounds } from "./finance.js";
import { readableEntrySql } from "./money-scope.js";
import { invalidRequest } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";
import { readableTripSql } from "./trip-scope.js";
import { dayStartSql, workspaceTimezone } from "./workspace-day.js";

/** A calendar window, both dates inclusive. */
export interface DateWindow {
  from: string;
  to: string;
}

const lastDayOf = (month: string): string => addDays(monthBounds(month).to, -1);

/**
 * The period a range covers on `today` (a workspace business date) and the one
 * it is compared with: this month so far against the same days of last month,
 * clamped to that month's length; otherwise whole closed months against the
 * same number of months just before.
 */
export function overviewWindows(
  today: string,
  range: OverviewRange,
): { period: DateWindow; comparison: DateWindow } {
  const month = today.slice(0, 7);
  if (range === "THIS_MONTH") {
    const previous = shiftMonth(month, -1);
    const lastDay = lastDayOf(previous);
    const day = Math.min(Number(today.slice(8, 10)), Number(lastDay.slice(8, 10)));
    return {
      period: { from: `${month}-01`, to: today },
      comparison: { from: `${previous}-01`, to: `${previous}-${String(day).padStart(2, "0")}` },
    };
  }
  const months = range === "THREE_MONTHS" ? 3 : 12;
  return {
    period: { from: `${shiftMonth(month, -months)}-01`, to: lastDayOf(shiftMonth(month, -1)) },
    comparison: {
      from: `${shiftMonth(month, -2 * months)}-01`,
      to: lastDayOf(shiftMonth(month, -months - 1)),
    },
  };
}

/** The closed months the chart draws, oldest first. */
export function overviewSeriesMonths(today: string): string[] {
  const month = today.slice(0, 7);
  return Array.from({ length: OVERVIEW_SERIES_MONTHS }, (_, i) =>
    shiftMonth(month, i - OVERVIEW_SERIES_MONTHS),
  );
}

/** The entry's economic date inside `window`. */
const within = (window: DateWindow): SQL =>
  and(gte(financialEntries.economicDate, window.from), lte(financialEntries.economicDate, window.to))!;

/** Lifecycle states after which a vehicle takes no new records (§4.1); listed only if it has money. */
const DISPOSED = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;

/** Money totals that fold into the response, kept as bigint until the end. */
interface Money {
  revenue: bigint;
  expense: bigint;
}

const zero = (): Money => ({ revenue: 0n, expense: 0n });
const add = (money: Money, direction: "REVENUE" | "EXPENSE", amount: bigint) => {
  if (direction === "REVENUE") money.revenue += amount;
  else money.expense += amount;
};

async function loadOverview(
  tx: TenantTx,
  auth: AuthContext,
  modules: ReadonlySet<string>,
  range: OverviewRange,
  branchId: string | undefined,
): Promise<FinanceOverviewResponse> {
  const [workspace] = await tx
    .select({ currency: workspaces.defaultCurrency })
    .from(workspaces)
    .where(eq(workspaces.id, auth.workspaceId));
  const currency = workspace?.currency ?? "XAF";
  const timezone = await workspaceTimezone(tx, auth.workspaceId);
  const today = currentBusinessDate(new Date(), timezone);
  const { period, comparison } = overviewWindows(today, range);
  const seriesMonths = overviewSeriesMonths(today);

  const withProfit = canReadLedger(auth.role);
  const tripsOn = modules.has("ACTIVITIES");
  const vehiclesOn = withProfit && modules.has("ASSETS");

  // The entries list's own scope (branch, then money scope), then the
  // requested branch inside it, never instead of it.
  const readable: SQL[] = [
    readableEntrySql(auth),
    ...(branchId === undefined ? [] : [eq(financialEntries.branchId, branchId)]),
  ];
  const posted: SQL[] = [
    ...readable,
    inArray(financialEntries.status, [...ledgerEntryStatuses]),
    eq(financialEntries.currency, currency),
  ];
  const entryJoin = and(
    eq(financialEntries.workspaceId, financialPostings.workspaceId),
    eq(financialEntries.id, financialPostings.financialEntryId),
  );

  // Postings, not entry amounts: they carry the vehicle and sum to their entry
  // (§3.4), so the vehicle split and the totals are the same lines.
  const inPeriod = within(period);
  const lineRows = await tx
    .select({
      inPeriod: sql<boolean>`${inPeriod}`,
      direction: financialEntries.direction,
      assetId: financialPostings.assetId,
      categoryId: financialPostings.categoryId,
      amountMinor: sql<string>`sum(${financialPostings.amountMinor})::text`,
    })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .where(and(...posted, or(inPeriod, within(comparison))))
    // By position: the same expression written twice binds its dates twice,
    // and Postgres would not see the two as one group key.
    .groupBy(sql`1`, sql`2`, sql`3`, sql`4`);

  const seriesRows = await tx
    .select({
      periodCode: sql<string>`to_char(${financialEntries.economicDate}, 'YYYY-MM')`,
      direction: financialEntries.direction,
      amountMinor: sql<string>`sum(${financialPostings.amountMinor})::text`,
    })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .where(
      and(
        ...posted,
        within({
          from: `${seriesMonths[0]}-01`,
          to: lastDayOf(seriesMonths[seriesMonths.length - 1]!),
        }),
      ),
    )
    .groupBy(sql`1`, sql`2`);

  const totals = { period: zero(), comparison: zero() };
  const companyCosts = { period: 0n, comparison: 0n };
  const revenueWithoutVehicle = { period: 0n, comparison: 0n };
  const byVehicle = new Map<string, Money>();
  const byCategory = new Map<
    string,
    { period: { expense: bigint; company: bigint }; comparison: { expense: bigint; company: bigint } }
  >();
  for (const row of lineRows) {
    const amount = BigInt(row.amountMinor);
    const window = row.inPeriod ? "period" : "comparison";
    add(totals[window], row.direction, amount);
    if (row.assetId === null) {
      if (row.direction === "EXPENSE") companyCosts[window] += amount;
      else revenueWithoutVehicle[window] += amount;
    } else if (window === "period") {
      const vehicle = byVehicle.get(row.assetId) ?? zero();
      add(vehicle, row.direction, amount);
      byVehicle.set(row.assetId, vehicle);
    }
    if (row.direction === "EXPENSE") {
      const category = byCategory.get(row.categoryId) ?? {
        period: { expense: 0n, company: 0n },
        comparison: { expense: 0n, company: 0n },
      };
      category[window].expense += amount;
      if (row.assetId === null) category[window].company += amount;
      byCategory.set(row.categoryId, category);
    }
  }

  // The comparison's vehicle profit is the same sum over its own lines.
  const comparisonVehicleProfit =
    totals.comparison.revenue -
    revenueWithoutVehicle.comparison -
    (totals.comparison.expense - companyCosts.comparison);

  const categoryIds = [...byCategory.keys()];
  const categoryRows =
    categoryIds.length === 0
      ? []
      : await tx
          .select({
            id: categories.id,
            code: categories.code,
            labelFr: categories.labelFr,
            labelEn: categories.labelEn,
            layer: categories.profitabilityLayer,
          })
          .from(categories)
          .where(and(eq(categories.workspaceId, auth.workspaceId), inArray(categories.id, categoryIds)));
  const expensesByCategory = categoryRows
    .map((category) => {
      const sums = byCategory.get(category.id)!;
      return {
        code: category.code,
        labelFr: category.labelFr,
        labelEn: category.labelEn,
        layer: category.layer,
        period: { expenseMinor: serializeMinor(sums.period.expense), companyCostMinor: serializeMinor(sums.period.company) },
        comparison: {
          expenseMinor: serializeMinor(sums.comparison.expense),
          companyCostMinor: serializeMinor(sums.comparison.company),
        },
      };
    })
    // A category whose lines were all cancelled nets to zero in both windows.
    .filter((row) => row.period.expenseMinor !== 0 || row.comparison.expenseMinor !== 0)
    .sort((a, b) => b.period.expenseMinor - a.period.expenseMinor || a.code.localeCompare(b.code));

  const seriesByMonth = new Map<string, Money>();
  for (const row of seriesRows) {
    const month = seriesByMonth.get(row.periodCode) ?? zero();
    add(month, row.direction, BigInt(row.amountMinor));
    seriesByMonth.set(row.periodCode, month);
  }

  const trips = tripsOn ? await loadTrips(tx, auth, branchId, period, timezone) : null;
  const vehicles = vehiclesOn ? await loadVehicles(tx, auth, branchId, byVehicle, trips) : null;
  const branchRows = vehicles === null ? null : await loadBranches(tx, auth, vehicles);

  const vehicleProfit = [...byVehicle.values()].reduce((sum, money) => sum + money.revenue - money.expense, 0n);
  const companyProfit = (
    vehicleSum: bigint,
    window: "period" | "comparison",
  ): OverviewCompanyProfit => ({
    vehicleProfitMinor: serializeMinor(vehicleSum),
    revenueWithoutVehicleMinor: serializeMinor(revenueWithoutVehicle[window]),
    companyCostsMinor: serializeMinor(companyCosts[window]),
    companyProfitMinor: serializeMinor(vehicleSum + revenueWithoutVehicle[window] - companyCosts[window]),
  });

  const gaps = await loadGaps(tx, readable, currency, period);

  const windowTotals = (window: DateWindow, money: Money) => ({
    from: window.from,
    to: window.to,
    revenueMinor: serializeMinor(money.revenue),
    expenseMinor: serializeMinor(money.expense),
    profitMinor: withProfit ? serializeMinor(money.revenue - money.expense) : null,
  });

  return {
    currency,
    range,
    branchId: branchId ?? null,
    view: withProfit ? "PROFIT" : "REVENUE_AND_EXPENSES",
    period: windowTotals(period, totals.period),
    comparison: windowTotals(comparison, totals.comparison),
    series: seriesMonths.map((periodCode) => {
      const month = seriesByMonth.get(periodCode) ?? zero();
      return {
        periodCode,
        revenueMinor: serializeMinor(month.revenue),
        expenseMinor: serializeMinor(month.expense),
      };
    }),
    expensesByCategory,
    vehicles,
    branches: branchRows,
    companyProfit: withProfit
      ? {
          period: companyProfit(vehicleProfit, "period"),
          comparison: companyProfit(comparisonVehicleProfit, "comparison"),
        }
      : null,
    counted: {
      postedEntries: gaps.postedEntries,
      closedTrips: trips === null ? null : trips.closedTrips,
    },
    notCounted: {
      waitingApproval: gaps.waitingApproval,
      missingReceipt: gaps.missingReceipt,
      openTrips: trips === null ? null : trips.openTrips,
      otherCurrencyEntries: gaps.otherCurrencyEntries,
    },
  };
}

interface TripFacts {
  closedTrips: number;
  openTrips: number;
  /** Per carrier: closed trips, known km, and trips with no km on its legs. */
  byVehicle: Map<string, { trips: number; km: number | null; withoutKm: number }>;
}

/**
 * Trips closed in the period (by the workspace's day) and trips open now,
 * scoped like the trips list. A trip counts for each vehicle that carried it,
 * PRIMARY or SUBSTITUTE; a leg's km go to the vehicle of its segment, or to the
 * trip's first carrier when the leg names none.
 */
async function loadTrips(
  tx: TenantTx,
  auth: AuthContext,
  branchId: string | undefined,
  period: DateWindow,
  timezone: string,
): Promise<TripFacts> {
  const scope: SQL[] = [
    readableTripSql(auth),
    ...(branchId === undefined ? [] : [eq(activities.branchId, branchId)]),
  ];
  const closedInPeriod = and(
    ...scope,
    eq(activities.status, "CLOSED"),
    sql`${activities.closedAt} >= ${dayStartSql(period.from, timezone)}`,
    sql`${activities.closedAt} < ${dayStartSql(addDays(period.to, 1), timezone)}`,
  )!;

  const [counts] = await tx
    .select({
      closed: sql<number>`count(*) filter (where ${closedInPeriod})::int`,
      open: sql<number>`count(*) filter (where ${activities.status} = 'OPEN')::int`,
    })
    .from(activities)
    .where(and(...scope));

  const carrierRows = await tx
    .selectDistinct({ tripId: activities.id, assetId: activityAssetSegments.assetId })
    .from(activities)
    .innerJoin(
      activityAssetSegments,
      and(
        eq(activityAssetSegments.workspaceId, activities.workspaceId),
        eq(activityAssetSegments.activityId, activities.id),
      ),
    )
    .where(and(closedInPeriod, inArray(activityAssetSegments.role, ["PRIMARY", "SUBSTITUTE"])));

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
    .where(and(closedInPeriod, isNotNull(movementLegs.distanceKm)))
    .groupBy(sql`1`, sql`2`);
  const kmByTripVehicle = new Map(legRows.map((row) => [`${row.tripId}:${row.assetId}`, row.km]));

  const byVehicle: TripFacts["byVehicle"] = new Map();
  for (const { tripId, assetId } of carrierRows) {
    const facts = byVehicle.get(assetId) ?? { trips: 0, km: null, withoutKm: 0 };
    facts.trips += 1;
    const km = kmByTripVehicle.get(`${tripId}:${assetId}`);
    if (km === undefined) facts.withoutKm += 1;
    else facts.km = (facts.km ?? 0) + km;
    byVehicle.set(assetId, facts);
  }

  return { closedTrips: counts?.closed ?? 0, openTrips: counts?.open ?? 0, byVehicle };
}

/**
 * Every active vehicle of the caller's branches (narrowed by `branchId`), plus
 * any vehicle with money in the period, losses first.
 */
async function loadVehicles(
  tx: TenantTx,
  auth: AuthContext,
  branchId: string | undefined,
  money: Map<string, Money>,
  trips: TripFacts | null,
): Promise<NonNullable<FinanceOverviewResponse["vehicles"]>> {
  const fleet: SQL[] = [notInArray(assets.lifecycleStatus, [...DISPOSED])];
  if (auth.branchScope !== "ALL") fleet.push(inArray(assets.branchId, auth.branchScope));
  if (branchId !== undefined) fleet.push(eq(assets.branchId, branchId));
  const withMoney = [...money.keys()];
  const rows = await tx
    .select({
      id: assets.id,
      assetCode: assets.assetCode,
      registrationNumber: assets.registrationNumber,
      branchId: assets.branchId,
    })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, auth.workspaceId),
        withMoney.length === 0 ? and(...fleet) : or(and(...fleet), inArray(assets.id, withMoney)),
      ),
    );

  return rows
    .map((asset) => {
      const sums = money.get(asset.id) ?? zero();
      const carried = trips?.byVehicle.get(asset.id);
      return {
        assetId: asset.id,
        assetCode: asset.assetCode,
        registrationNumber: asset.registrationNumber,
        branchId: asset.branchId,
        tripsClosed: trips === null ? null : (carried?.trips ?? 0),
        distanceKm: trips === null ? null : (carried?.km ?? null),
        tripsWithoutKm: trips === null ? null : (carried?.withoutKm ?? 0),
        revenueMinor: serializeMinor(sums.revenue),
        expenseMinor: serializeMinor(sums.expense),
        profitMinor: serializeMinor(sums.revenue - sums.expense),
      };
    })
    .sort((a, b) => a.profitMinor - b.profitMinor || a.assetCode.localeCompare(b.assetCode));
}

/** Vehicle profit by the vehicle's branch, from the vehicle rows, so the two always agree. */
async function loadBranches(
  tx: TenantTx,
  auth: AuthContext,
  vehicles: NonNullable<FinanceOverviewResponse["vehicles"]>,
): Promise<NonNullable<FinanceOverviewResponse["branches"]>> {
  const ids = [...new Set(vehicles.map((vehicle) => vehicle.branchId))];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(and(eq(branches.workspaceId, auth.workspaceId), inArray(branches.id, ids)));
  return rows
    .map((branch) => {
      const own = vehicles.filter((vehicle) => vehicle.branchId === branch.id);
      const sum = (pick: (vehicle: (typeof own)[number]) => number) =>
        serializeMinor(own.reduce((total, vehicle) => total + BigInt(pick(vehicle)), 0n));
      return {
        branchId: branch.id,
        code: branch.code,
        name: branch.name,
        vehicleCount: own.length,
        revenueMinor: sum((vehicle) => vehicle.revenueMinor),
        expenseMinor: sum((vehicle) => vehicle.expenseMinor),
        vehicleProfitMinor: sum((vehicle) => vehicle.profitMinor),
      };
    })
    .sort((a, b) => b.vehicleProfitMinor - a.vehicleProfitMinor || a.code.localeCompare(b.code));
}

/** What the period's totals count, and what they leave out, over the same readable entries. */
async function loadGaps(tx: TenantTx, readable: SQL[], currency: string, period: DateWindow) {
  const inPeriod = within(period);
  const absolute = sql`abs(${financialEntries.amountMinor})`;
  const isPosted = inArray(financialEntries.status, [...ledgerEntryStatuses]);
  const waiting = eq(financialEntries.status, "SUBMITTED");
  const missing = and(
    or(waiting, eq(financialEntries.status, "POSTED")),
    eq(financialEntries.currency, currency),
    entryEvidenceMissingSql(),
  );
  const [row] = await tx
    .select({
      postedEntries: sql<number>`count(*) filter (where ${and(isPosted, eq(financialEntries.currency, currency))})::int`,
      waitingCount: sql<number>`count(*) filter (where ${and(waiting, eq(financialEntries.currency, currency))})::int`,
      waitingMinor: sql<string>`coalesce(sum(${absolute}) filter (where ${and(waiting, eq(financialEntries.currency, currency))}), 0)::text`,
      missingCount: sql<number>`count(*) filter (where ${missing})::int`,
      missingMinor: sql<string>`coalesce(sum(${absolute}) filter (where ${missing}), 0)::text`,
      otherCurrency: sql<number>`count(*) filter (where ${and(isPosted, ne(financialEntries.currency, currency))})::int`,
    })
    .from(financialEntries)
    .where(and(...readable, inPeriod));
  return {
    postedEntries: row?.postedEntries ?? 0,
    waitingApproval: { count: row?.waitingCount ?? 0, amountMinor: serializeMinor(BigInt(row?.waitingMinor ?? "0")) },
    missingReceipt: { count: row?.missingCount ?? 0, amountMinor: serializeMinor(BigInt(row?.missingMinor ?? "0")) },
    otherCurrencyEntries: row?.otherCurrency ?? 0,
  };
}

/**
 * `GET /v1/finance/overview` (#660): the money every Overview shows. Gated
 * like the ledger, with the cashier let in for their branch's revenue and
 * expenses and no profit (`MONEY_OVERVIEW_READER_ROLES`); everyone else gets
 * 403. Rows are narrowed by `readableEntrySql`, so an administrator's figures
 * stop at their branches.
 */
export function registerFinanceOverviewReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    {
      path: "/v1/finance/overview",
      module: "FINANCE",
      roles: MONEY_OVERVIEW_READER_ROLES,
      branchScope: "per-record",
    },
    async ({ req, auth, modules, read }) => {
      const query = financeOverviewQuery.safeParse(req.query);
      if (!query.success) throw invalidRequest();
      const { range, branchId } = query.data;
      const body = await read((tx) => loadOverview(tx, auth, modules, range, branchId));
      return financeOverviewResponse.parse(body);
    },
  );
}
