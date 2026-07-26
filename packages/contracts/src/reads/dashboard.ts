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
});

/** `GET /v1/dashboard` — aggregates computed per request, no projections (ADR-0003). */
export const dashboardResponse = z.object({
  assets: dashboardAssetCounts,
  /** Null when the workspace has no open period yet — nothing has been posted. */
  openPeriod: dashboardOpenPeriod.nullable(),
  pendingApprovals: dashboardPendingApprovals,
});

export type DashboardAssetCounts = z.infer<typeof dashboardAssetCounts>;
export type DashboardOpenPeriod = z.infer<typeof dashboardOpenPeriod>;
export type DashboardResponse = z.infer<typeof dashboardResponse>;
