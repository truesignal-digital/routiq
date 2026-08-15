import { z } from "zod";
import { assetLifecycleStatus } from "./assets.js";

/**
 * Exhaustive over the lifecycle enum: a status with no assets is `0`, never a
 * missing key, so the dashboard never renders a blank where a zero belongs.
 */
export const dashboardAssetCounts = z.object({
  total: z.number().int().nonnegative(),
  byStatus: z.record(assetLifecycleStatus, z.number().int().nonnegative()),
});

/**
 * Posted totals for the workspace's current open period, in minor units of the
 * workspace default currency (XAF has exponent 0 — 1 XAF = 1 minor unit).
 * Signed, because postings are: a reversal posted into a later period drags
 * that period's total down, and the honest number shows it.
 */
export const dashboardOpenPeriod = z.object({
  periodCode: z.string(),
  postedExpenseMinor: z.number().int(),
  postedRevenueMinor: z.number().int(),
  currency: z.string().length(3),
});

export const dashboardPendingApprovals = z.object({
  count: z.number().int().nonnegative(),
  /**
   * Pending work the `branchId` narrowing leaves out, inside the caller's own
   * scope — zero without a narrowing. The card reports it because work hidden
   * by an ambient lens is work nobody decides. Defaulted so a payload from
   * before it existed still parses as "nothing hidden".
   */
  outsideBranchCount: z.number().int().nonnegative().default(0),
});

/** A week is the tightest chart worth drawing; a year the widest we zero-fill per day. */
export const DASHBOARD_SERIES_DAYS_MIN = 7;
export const DASHBOARD_SERIES_DAYS_MAX = 365;
export const DASHBOARD_SERIES_DAYS_DEFAULT = 90;

/**
 * `GET /v1/dashboard` — the chart window and an optional branch narrowing are
 * client-chosen; scope never is (ADR-0003). `branchId` narrows *within* the
 * caller's branch scope and can never widen it: a branch outside that scope
 * simply matches nothing.
 */
export const dashboardQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .min(DASHBOARD_SERIES_DAYS_MIN)
    .max(DASHBOARD_SERIES_DAYS_MAX)
    .default(DASHBOARD_SERIES_DAYS_DEFAULT),
  branchId: z.uuid().optional(),
});

/**
 * One day of posted totals, bucketed on the entry's economic date — the
 * business date, not `posted_at` — so the chart answers "what happened when",
 * the same question period membership answers. Signed and in minor units of
 * the workspace default currency, like the period totals above.
 */
export const dashboardSeriesPoint = z.object({
  date: z.iso.date(),
  expenseMinor: z.number().int(),
  revenueMinor: z.number().int(),
});

/** `GET /v1/dashboard` — aggregates computed per request, no projections (ADR-0003). */
export const dashboardResponse = z.object({
  assets: dashboardAssetCounts,
  /** Null when the workspace has no open period yet — nothing has been posted. */
  openPeriod: dashboardOpenPeriod.nullable(),
  pendingApprovals: dashboardPendingApprovals,
  /**
   * Every day of the requested window, ascending, zero-filled: a day with no
   * postings arrives as an explicit zero so the chart plots a flat line there
   * instead of interpolating across a gap it cannot see.
   */
  series: z.array(dashboardSeriesPoint),
});

export type DashboardAssetCounts = z.infer<typeof dashboardAssetCounts>;
export type DashboardOpenPeriod = z.infer<typeof dashboardOpenPeriod>;
export type DashboardQuery = z.infer<typeof dashboardQuery>;
export type DashboardSeriesPoint = z.infer<typeof dashboardSeriesPoint>;
export type DashboardResponse = z.infer<typeof dashboardResponse>;
