import {
  COMING_UP_READER_ROLES,
  comingUpQuery,
  comingUpResponse,
  comingUpWaitsOn,
  FLEET_ATTENTION_ROW_LIMIT,
  TODO_CODES,
  TODO_READER_ROLES,
  TODO_SAFETY_CODES,
  todoResponse,
  todoWaitsOn,
  type ComingUpRow,
  type ModuleCode,
  type TodoCode,
  type TodoRow,
} from "@routiq/contracts";
import { and, desc, eq, gte, inArray, isNull, lt, notInArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import { currentPeriodCode } from "../commands/periods.js";
import type { Db } from "../db/client.js";
import {
  activities,
  assetAvailabilityIntervals,
  assets,
  financialEntries,
  operationalIssues,
  postingPeriods,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { decidablePendingEntries } from "./approvals-queue.js";
import { daysBetween, documentAttentionRows, evidenceStillDueSql, maintenanceItems } from "./asset-attention.js";
import { addDays, currentBusinessDate } from "./business-date.js";
import { defineRead } from "./define-read.js";
import { readableEntrySql } from "./money-scope.js";
import { invalidRequest } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";
import { dayStartSql, workspaceTimezone } from "./workspace-day.js";

/** No new operational records after these (§4.1), so nothing on them waits. */
const DISPOSED = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;

const SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

/**
 * The vehicles every row counts: the caller's whole Branch Scope, never the
 * Ambient Branch (CONTEXT.md), less the vehicles that left the fleet.
 */
function fleetVehiclesSql(auth: AuthContext): SQL {
  const conditions: SQL[] = [
    eq(assets.workspaceId, auth.workspaceId),
    notInArray(assets.lifecycleStatus, [...DISPOSED]),
  ];
  if (auth.branchScope !== "ALL") conditions.push(inArray(assets.branchId, auth.branchScope));
  return and(...conditions)!;
}

function scopeOf(auth: AuthContext) {
  return {
    ambientBranch: "IGNORED" as const,
    branchIds: auth.branchScope === "ALL" ? ("ALL" as const) : [...auth.branchScope],
  };
}

interface Today {
  timezone: string;
  businessDate: string;
}

/** Whole business days from an instant to today. */
const daysSince = (at: Date, today: Today) =>
  Math.max(0, daysBetween(currentBusinessDate(at, today.timezone), today.businessDate));

/**
 * Grounded vehicles and problems nobody planned, by the truck page's own
 * builder run on each vehicle that has one, so the two can never disagree.
 */
async function maintenanceRows(tx: TenantTx, auth: AuthContext, today: Today): Promise<TodoRow[]> {
  const wantGrounded = todoWaitsOn("VEHICLE_GROUNDED", auth.role);
  const wantIssues = todoWaitsOn("ISSUE_UNPLANNED", auth.role);
  if (!wantGrounded && !wantIssues) return [];

  const grounded = await tx
    .select({
      assetId: assets.id,
      assetCode: assets.assetCode,
      branchId: assets.branchId,
      intervalId: assetAvailabilityIntervals.id,
      openedAt: assetAvailabilityIntervals.openedAt,
      description: operationalIssues.description,
      safetyCritical: operationalIssues.safetyCritical,
    })
    .from(assetAvailabilityIntervals)
    .innerJoin(
      assets,
      and(eq(assets.workspaceId, assetAvailabilityIntervals.workspaceId), eq(assets.id, assetAvailabilityIntervals.assetId)),
    )
    .innerJoin(
      operationalIssues,
      and(
        eq(operationalIssues.workspaceId, assetAvailabilityIntervals.workspaceId),
        eq(operationalIssues.id, assetAvailabilityIntervals.openedByIssueId),
      ),
    )
    .where(and(fleetVehiclesSql(auth), isNull(assetAvailabilityIntervals.closedAt)));
  const withIssues = wantIssues
    ? await tx
        .selectDistinct({ assetId: assets.id, assetCode: assets.assetCode, branchId: assets.branchId })
        .from(operationalIssues)
        .innerJoin(assets, and(eq(assets.workspaceId, operationalIssues.workspaceId), eq(assets.id, operationalIssues.assetId)))
        .where(and(fleetVehiclesSql(auth), eq(operationalIssues.status, "OPEN")))
    : [];

  const vehicles = new Map<string, { id: string; assetCode: string; branchId: string }>();
  for (const row of [...grounded, ...withIssues]) {
    vehicles.set(row.assetId, { id: row.assetId, assetCode: row.assetCode, branchId: row.branchId });
  }
  const groundings = new Map(grounded.map((row) => [row.assetId, row]));

  const rows: TodoRow[] = [];
  for (const vehicle of [...vehicles.values()].sort((a, b) => a.assetCode.localeCompare(b.assetCode))) {
    // Costs are no part of these rows, so the builder is asked without the books.
    const { items } = await maintenanceItems(tx, auth, vehicle.id, false);
    const asset = { id: vehicle.id, assetCode: vehicle.assetCode };
    const grounding = groundings.get(vehicle.id);
    if (grounding && wantGrounded) {
      rows.push({
        code: "VEHICLE_GROUNDED",
        severity: "CRITICAL",
        link: { kind: "asset", id: vehicle.id, number: vehicle.assetCode },
        asset,
        branchId: vehicle.branchId,
        since: grounding.openedAt.toISOString(),
        params: {
          days: daysSince(grounding.openedAt, today),
          description: clip(grounding.description),
          safetyCritical: grounding.safetyCritical,
          workOrderPlanned: items.some((item) => item.partOfGrounding && item.subject.entityType === "work_order"),
          readyForRelease: items.some((item) => item.code === "ASSET_AWAITING_RELEASE"),
        },
      });
    }
    if (!wantIssues) continue;
    for (const item of items) {
      // The grounded row already speaks for the problem that grounded it.
      if (item.code !== "ISSUE_UNPLANNED" || (item.partOfGrounding && grounding)) continue;
      const since = new Date(item.since);
      rows.push({
        code: "ISSUE_UNPLANNED",
        severity: item.severity,
        link: { kind: "operational_issue", id: item.subject.id, number: null },
        asset,
        branchId: vehicle.branchId,
        since: item.since,
        params: {
          days: daysSince(since, today),
          ...pick(item.params, ["description", "safetyCritical", "categoryLabelFr", "categoryLabelEn"]),
        },
      });
    }
  }
  return rows;
}

const clip = (text: string): string => (text.length > 140 ? `${text.slice(0, 139)}…` : text);

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

/** Expired and expiring documents, by the truck page's window and rule. */
async function documentRows(tx: TenantTx, auth: AuthContext, today: Today): Promise<TodoRow[]> {
  const rows = await documentAttentionRows(
    tx,
    auth.workspaceId,
    fleetVehiclesSql(auth),
    today.businessDate,
    today.timezone,
  );
  return rows.map(({ asset, item }) => ({
    code: item.code === "DOCUMENT_EXPIRED" ? "DOCUMENT_EXPIRED" : "DOCUMENT_EXPIRING",
    severity: item.severity,
    link: { kind: "document", id: item.subject.id, number: item.subject.number },
    asset: { id: asset.id, assetCode: asset.assetCode },
    branchId: asset.branchId,
    since: item.since,
    params: pick(item.params, ["documentTypeLabelFr", "documentTypeLabelEn", "expiresAt", "daysLeft"]),
  }));
}

interface Summed {
  currency: string;
  count: number;
  amountMinor: bigint;
  oldest: Date;
}

function summedRow(code: "ENTRIES_AWAITING_APPROVAL" | "ENTRIES_EVIDENCE_MISSING", sum: Summed, today: Today): TodoRow {
  return {
    code,
    severity: "WARNING",
    link: {
      kind: code === "ENTRIES_AWAITING_APPROVAL" ? "approvals" : "entries_evidence_missing",
      id: null,
      number: null,
    },
    asset: null,
    branchId: null,
    since: sum.oldest.toISOString(),
    params: {
      count: sum.count,
      amountMinor: serializeMinor(sum.amountMinor),
      currency: sum.currency,
      days: daysSince(sum.oldest, today),
    },
  };
}

/** The expenses this caller may decide: the Money badge's own list (#542), summed per currency. */
async function approvalRows(tx: TenantTx, auth: AuthContext, today: Today): Promise<TodoRow[]> {
  const byCurrency = new Map<string, Summed>();
  for (const entry of await decidablePendingEntries(tx, auth)) {
    const sum = byCurrency.get(entry.currency);
    if (sum === undefined) {
      byCurrency.set(entry.currency, { currency: entry.currency, count: 1, amountMinor: entry.amountMinor, oldest: entry.submittedAt });
    } else {
      sum.count += 1;
      sum.amountMinor += entry.amountMinor;
      if (entry.submittedAt < sum.oldest) sum.oldest = entry.submittedAt;
    }
  }
  return [...byCurrency.values()].map((sum) => summedRow("ENTRIES_AWAITING_APPROVAL", sum, today));
}

/** Entries the caller may read that still owe a receipt (ENTRY_EVIDENCE_MISSING), per currency. */
async function evidenceRows(tx: TenantTx, auth: AuthContext, today: Today): Promise<TodoRow[]> {
  const sums = await tx
    .select({
      currency: financialEntries.currency,
      count: sql<number>`count(*)::integer`,
      amountMinor: sql<string>`sum(${financialEntries.amountMinor})::text`,
      oldest: sql<Date>`min(${financialEntries.createdAt})`.mapWith(financialEntries.createdAt),
    })
    .from(financialEntries)
    .where(and(readableEntrySql(auth), evidenceStillDueSql()))
    .groupBy(financialEntries.currency);
  return sums.map((sum) =>
    summedRow("ENTRIES_EVIDENCE_MISSING", { ...sum, amountMinor: BigInt(sum.amountMinor) }, today),
  );
}

function nextMonthStart(periodCode: string): string {
  const year = Number(periodCode.slice(0, 4));
  const month = Number(periodCode.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/**
 * The latest past month still OPEN, with what stands in the way of locking
 * it: entries still waiting (lock-period warns PERIOD_HAS_SUBMITTED_ENTRIES)
 * and receipts still missing, both counted in the caller's branches.
 */
async function periodRows(tx: TenantTx, auth: AuthContext, today: Today): Promise<TodoRow[]> {
  const current = currentPeriodCode(new Date(), today.timezone);
  const open = await tx
    .select({ id: postingPeriods.id, periodCode: postingPeriods.periodCode })
    .from(postingPeriods)
    .where(
      and(
        eq(postingPeriods.workspaceId, auth.workspaceId),
        eq(postingPeriods.status, "OPEN"),
        lt(postingPeriods.periodCode, current),
      ),
    )
    .orderBy(desc(postingPeriods.periodCode));
  const [period] = open;
  if (period === undefined) return [];

  const end = nextMonthStart(period.periodCode);
  const inMonth: SQL[] = [
    eq(financialEntries.workspaceId, auth.workspaceId),
    gte(financialEntries.economicDate, `${period.periodCode}-01`),
    lt(financialEntries.economicDate, end),
  ];
  if (auth.branchScope !== "ALL") inMonth.push(inArray(financialEntries.branchId, auth.branchScope));
  const [counts] = await tx
    .select({
      submitted: sql<number>`count(*) filter (where ${financialEntries.status} = 'SUBMITTED')::integer`,
      evidenceMissing: sql<number>`count(*) filter (where ${evidenceStillDueSql()})::integer`,
    })
    .from(financialEntries)
    .where(and(...inMonth));

  // A month has a date, not an instant: UTC midnight of the day after it, as documents do.
  const since = `${end}T00:00:00.000Z`;
  return [
    {
      code: "PERIOD_OPEN",
      severity: "INFO",
      link: { kind: "posting_period", id: period.id, number: period.periodCode },
      asset: null,
      branchId: null,
      since,
      params: {
        periodCode: period.periodCode,
        submittedCount: counts?.submitted ?? 0,
        evidenceMissingCount: counts?.evidenceMissing ?? 0,
        olderOpenCount: open.length - 1,
        days: Math.max(0, daysBetween(end, today.businessDate)),
      },
    },
  ];
}

/**
 * Safety, then money (TODO_SAFETY_CODES, then TODO_MONEY_CODES). Safety rows
 * most severe first, then grounded, problems, documents, then oldest first.
 * Money rows in code order (decisions, receipts, the month), largest first.
 */
function rankTodo(rows: TodoRow[]): TodoRow[] {
  const order = (code: TodoCode) => TODO_CODES.indexOf(code);
  const safe = (row: TodoRow) => (TODO_SAFETY_CODES as readonly TodoCode[]).includes(row.code);
  const amount = (row: TodoRow) => (row.params.amountMinor === undefined ? 0 : Math.abs(row.params.amountMinor));
  return [...rows].sort(
    (left, right) =>
      Number(!safe(left)) - Number(!safe(right)) ||
      (safe(left) ? SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] : 0) ||
      order(left.code) - order(right.code) ||
      amount(right) - amount(left) ||
      left.since.localeCompare(right.since) ||
      (left.link.id ?? left.code).localeCompare(right.link.id ?? right.code),
  );
}

async function loadToday(tx: TenantTx, auth: AuthContext): Promise<Today> {
  const timezone = await workspaceTimezone(tx, auth.workspaceId);
  return { timezone, businessDate: currentBusinessDate(new Date(), timezone) };
}

async function loadTodo(tx: TenantTx, auth: AuthContext, modules: ReadonlySet<ModuleCode>) {
  const today = await loadToday(tx, auth);
  const rows: TodoRow[] = [];
  if (modules.has("MAINTENANCE")) rows.push(...(await maintenanceRows(tx, auth, today)));
  if (modules.has("DOCUMENTS") && todoWaitsOn("DOCUMENT_EXPIRED", auth.role)) {
    rows.push(...(await documentRows(tx, auth, today)));
  }
  if (modules.has("FINANCE")) {
    if (todoWaitsOn("ENTRIES_AWAITING_APPROVAL", auth.role)) rows.push(...(await approvalRows(tx, auth, today)));
    if (todoWaitsOn("ENTRIES_EVIDENCE_MISSING", auth.role)) rows.push(...(await evidenceRows(tx, auth, today)));
    if (todoWaitsOn("PERIOD_OPEN", auth.role)) rows.push(...(await periodRows(tx, auth, today)));
  }
  const ranked = rankTodo(rows);
  return {
    businessDate: today.businessDate,
    scope: scopeOf(auth),
    rows: ranked.slice(0, FLEET_ATTENTION_ROW_LIMIT),
    totalCount: ranked.length,
  };
}

/** PLANNED trips starting inside the window, in the caller's branches, and those still without a vehicle. */
async function plannedTripRows(tx: TenantTx, auth: AuthContext, today: Today, days: number): Promise<ComingUpRow[]> {
  const conditions: SQL[] = [
    eq(activities.workspaceId, auth.workspaceId),
    eq(activities.status, "PLANNED"),
    sql`${activities.plannedStartAt} >= ${dayStartSql(today.businessDate, today.timezone)}`,
    sql`${activities.plannedStartAt} < ${dayStartSql(addDays(today.businessDate, days + 1), today.timezone)}`,
  ];
  if (auth.branchScope !== "ALL") conditions.push(inArray(activities.branchId, auth.branchScope));
  const [row] = await tx
    .select({
      planned: sql<number>`count(*)::integer`,
      withoutVehicle: sql<number>`count(*) filter (where ${activities.plannedAssetId} is null)::integer`,
      first: sql<Date | null>`min(${activities.plannedStartAt})`.mapWith(activities.plannedStartAt),
    })
    .from(activities)
    .where(and(...conditions));
  if (!row || row.planned === 0 || row.first === null) return [];
  return [
    {
      code: "TRIPS_PLANNED",
      link: { kind: "planning", id: null, number: null },
      asset: null,
      branchId: null,
      dueDate: currentBusinessDate(row.first, today.timezone),
      params: { plannedCount: row.planned, withoutVehicleCount: row.withoutVehicle },
    },
  ];
}

async function loadComingUp(tx: TenantTx, auth: AuthContext, modules: ReadonlySet<ModuleCode>, days: 14 | 30) {
  const today = await loadToday(tx, auth);
  const rows: ComingUpRow[] = [];
  if (modules.has("DOCUMENTS") && comingUpWaitsOn("DOCUMENT_DUE", auth.role)) {
    const documents = await documentAttentionRows(
      tx,
      auth.workspaceId,
      fleetVehiclesSql(auth),
      today.businessDate,
      today.timezone,
      days,
    );
    for (const { asset, item } of documents) {
      // Expired ones are To do, not coming up.
      if (item.code !== "DOCUMENT_EXPIRING" || item.params.expiresAt === undefined) continue;
      rows.push({
        code: "DOCUMENT_DUE",
        link: { kind: "document", id: item.subject.id, number: item.subject.number },
        asset: { id: asset.id, assetCode: asset.assetCode },
        branchId: asset.branchId,
        dueDate: item.params.expiresAt,
        params: {
          ...pick(item.params, ["documentTypeLabelFr", "documentTypeLabelEn"]),
          daysLeft: daysBetween(today.businessDate, item.params.expiresAt),
        },
      });
    }
  }
  if (modules.has("SCHEDULING") && modules.has("ACTIVITIES") && comingUpWaitsOn("TRIPS_PLANNED", auth.role)) {
    rows.push(...(await plannedTripRows(tx, auth, today, days)));
  }
  rows.sort(
    (left, right) =>
      left.dueDate.localeCompare(right.dueDate) ||
      left.code.localeCompare(right.code) ||
      (left.link.id ?? "").localeCompare(right.link.id ?? ""),
  );
  return {
    businessDate: today.businessDate,
    windowDays: days,
    scope: scopeOf(auth),
    rows: rows.slice(0, FLEET_ATTENTION_ROW_LIMIT),
    totalCount: rows.length,
    // No vehicle records a service interval yet, so a service due by km cannot be counted.
    notCounted: modules.has("MAINTENANCE") ? (["SERVICE_DUE_BY_KM"] as const) : [],
  };
}

/**
 * The Overviews' To do and Coming up (#661): what waits across every vehicle
 * the caller can see. Each row carries its own gates (module and role,
 * TODO_ROLES / COMING_UP_ROLES); the read belongs to CORE like the navigation
 * counts, and always counts the caller's whole Branch Scope: a `branchId` in
 * the query is ignored, as the Ambient Branch never narrows attention.
 */
export function registerFleetAttentionReadRoutes(app: FastifyInstance, db: Db, requireAuth: RequireAuth) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/todo", module: "CORE", roles: TODO_READER_ROLES, branchScope: "per-record" },
    async ({ auth, modules, read }) => todoResponse.parse(await read((tx) => loadTodo(tx, auth, modules))),
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/coming-up", module: "CORE", roles: COMING_UP_READER_ROLES, branchScope: "per-record" },
    async ({ req, auth, modules, read }) => {
      const query = comingUpQuery.safeParse(req.query);
      if (!query.success) throw invalidRequest();
      const days = query.data.days === 30 ? 30 : 14;
      return comingUpResponse.parse(await read((tx) => loadComingUp(tx, auth, modules, days)));
    },
  );
}
