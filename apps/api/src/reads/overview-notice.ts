import {
  DEFAULT_SUMMARY_SCHEDULE,
  GROUNDED_CHANGE_DAYS,
  type OverviewNotice,
  type OverviewNoticeChange,
  type SummarySchedule,
  type SummaryScheduleReason,
} from "@routiq/contracts";
import { and, asc, eq, gte, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { AuthContext } from "../auth/types.js";
import { assetAvailabilityIntervals, assets, companySettings } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { addDays, currentBusinessDate } from "./business-date.js";
import { dayStartSql, workspaceTimezone } from "./workspace-day.js";

const DISPOSED = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;

/**
 * The company's schedule (#669): every Monday and the 1st of the month by
 * default, Mondays only, the 1st only, or never. Returns the latest scheduled
 * day on or before `today` and why today is one, if it is. A Monday that is
 * also the 1st is the 1st when the 1st is on the schedule.
 */
export function summarySchedule(
  today: string,
  schedule: SummarySchedule = DEFAULT_SUMMARY_SCHEDULE,
): {
  scheduledOn: string | null;
  scheduledToday: SummaryScheduleReason | null;
} {
  if (schedule === "NEVER") return { scheduledOn: null, scheduledToday: null };
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const lastMonday = addDays(today, -((weekday + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const mondays = schedule !== "MONTH_START";
  const firsts = schedule !== "MONDAY";
  const scheduledOn = !firsts ? lastMonday : !mondays ? monthStart : lastMonday > monthStart ? lastMonday : monthStart;
  const scheduledToday =
    firsts && today === monthStart ? "MONTH_START" : mondays && weekday === 1 ? "MONDAY" : null;
  return { scheduledOn, scheduledToday };
}

/** The workspace's Dashboard summary setting; the default until Direction changes it. */
export async function loadSummarySchedule(tx: TenantTx, workspaceId: string): Promise<{
  schedule: SummarySchedule;
  version: number;
}> {
  const [row] = await tx
    .select({ schedule: companySettings.summarySchedule, version: companySettings.rowVersion })
    .from(companySettings)
    .where(eq(companySettings.workspaceId, workspaceId));
  return row ?? { schedule: DEFAULT_SUMMARY_SCHEDULE, version: 0 };
}

/**
 * Vehicles grounded in the last `GROUNDED_CHANGE_DAYS` workspace days and
 * still off the road, in the caller's branch scope narrowed by `branchId`.
 * Nothing while Assets or Maintenance is off: groundings are Maintenance's.
 */
async function groundedChanges(
  tx: TenantTx,
  auth: AuthContext,
  modules: ReadonlySet<string>,
  branchId: string | undefined,
  today: string,
  timezone: string,
): Promise<OverviewNoticeChange[]> {
  if (!modules.has("ASSETS") || !modules.has("MAINTENANCE")) return [];
  const scope: SQL[] = [
    eq(assets.workspaceId, auth.workspaceId),
    notInArray(assets.lifecycleStatus, [...DISPOSED]),
    isNull(assetAvailabilityIntervals.closedAt),
    gte(assetAvailabilityIntervals.openedAt, sql`${dayStartSql(addDays(today, 1 - GROUNDED_CHANGE_DAYS), timezone)}`),
  ];
  if (auth.branchScope !== "ALL") scope.push(inArray(assets.branchId, auth.branchScope));
  if (branchId !== undefined) scope.push(eq(assets.branchId, branchId));
  const rows = await tx
    .select({
      intervalId: assetAvailabilityIntervals.id,
      assetId: assets.id,
      assetCode: assets.assetCode,
      since: assetAvailabilityIntervals.openedAt,
    })
    .from(assetAvailabilityIntervals)
    .innerJoin(
      assets,
      and(eq(assets.workspaceId, assetAvailabilityIntervals.workspaceId), eq(assets.id, assetAvailabilityIntervals.assetId)),
    )
    .where(and(...scope))
    .orderBy(asc(assetAvailabilityIntervals.openedAt), asc(assets.assetCode));
  return rows.map((row) => ({
    kind: "VEHICLE_GROUNDED" as const,
    key: `VEHICLE_GROUNDED:${row.intervalId}`,
    assetId: row.assetId,
    assetCode: row.assetCode,
    since: row.since.toISOString(),
  }));
}

/**
 * When an Overview's summary notice shows: the company's schedule, plus big
 * changes. Groundings come from here; a read that knows more (the money
 * read's expenses up) passes its own changes in `extra`. The changes are
 * listed whatever the schedule: the web shows no notice for them under NEVER,
 * but "Show summary" still names them.
 */
export async function loadOverviewNotice(
  tx: TenantTx,
  auth: AuthContext,
  modules: ReadonlySet<string>,
  options: { branchId: string | undefined; today: string; timezone: string },
  extra: readonly OverviewNoticeChange[] = [],
): Promise<OverviewNotice> {
  const { branchId, today, timezone } = options;
  const { schedule } = await loadSummarySchedule(tx, auth.workspaceId);
  return {
    today,
    schedule,
    ...summarySchedule(today, schedule),
    changes: [...(await groundedChanges(tx, auth, modules, branchId, today, timezone)), ...extra],
  };
}

/** The notice for a read that has not looked up the workspace's day itself. */
export async function overviewNoticeToday(
  tx: TenantTx,
  auth: AuthContext,
  modules: ReadonlySet<string>,
  branchId: string | undefined,
): Promise<OverviewNotice> {
  const timezone = await workspaceTimezone(tx, auth.workspaceId);
  const today = currentBusinessDate(new Date(), timezone);
  return loadOverviewNotice(tx, auth, modules, { branchId, today, timezone });
}
