import { z } from "zod";
import { activityCompleteness, activityStatus } from "./activities.js";
import { listResponse } from "./list.js";

export const assetLifecycleStatuses = [
  "REGISTERED",
  "IN_SERVICE",
  "UNDER_MAINTENANCE",
  "SOLD",
  "RETIRED",
  "WRITTEN_OFF",
] as const;

export const assetLifecycleStatus = z.enum(assetLifecycleStatuses);

export const assetListItem = z.object({
  id: z.uuid(),
  assetCode: z.string(),
  registrationNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  lifecycleStatus: assetLifecycleStatus,
  rowVersion: z.number(),
  category: z.object({
    code: z.string(),
    labelFr: z.string(),
    labelEn: z.string(),
  }),
  branch: z.object({
    code: z.string(),
    name: z.string(),
  }),
});

/** `items`, the default key — the legacy `entries` escape hatch is finance-only. */
export const assetListResponse = listResponse(assetListItem);

/** One expense category's signed total for the asset. */
export const assetExpenseCategoryTotal = z.object({
  code: z.string(),
  labelFr: z.string(),
  labelEn: z.string(),
  totalMinor: z.number().int(),
});

/**
 * Lifetime profitability of one asset, summed from SIGNED postings so a
 * reversal subtracts rather than appearing as a second charge (§3.4).
 * `netMinor` is revenue minus expense — negative means the asset lost money.
 */
export const assetFinancialSummary = z.object({
  currency: z.string().length(3),
  revenueMinor: z.number().int(),
  expenseMinor: z.number().int(),
  netMinor: z.number().int(),
  expenseByCategory: z.array(assetExpenseCategoryTotal),
});

/** The activity fields the asset page shows; the full shape lives on the activity detail read. */
export const assetRecentActivity = z.object({
  id: z.uuid(),
  activityNumber: z.string(),
  activityType: z.object({
    code: z.string(),
    labelFr: z.string(),
    labelEn: z.string(),
  }),
  status: activityStatus,
  completeness: activityCompleteness.nullable(),
  customerName: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
});

export const assetDetail = assetListItem.extend({
  branchId: z.uuid(),
  assetClassCode: z.string(),
  templateCode: z.enum(["TRUCKING", "PASSENGER_TRANSPORT"]),
  templateVersion: z.number().int().positive(),
  chassisNumber: z.string().nullable(),
  modelYear: z.number().int().nullable(),
  acquisitionDate: z.iso.date().nullable(),
  acquisitionAmountMinor: z.number().int().nullable(),
  currency: z.string().length(3),
  commissionedAt: z.iso.datetime().nullable(),
  customValues: z.record(z.string(), z.unknown()),
  finance: assetFinancialSummary,
  recentActivities: z.array(assetRecentActivity),
});

export type AssetLifecycleStatus = z.infer<typeof assetLifecycleStatus>;
export type AssetListItem = z.infer<typeof assetListItem>;
export type AssetListResponse = z.infer<typeof assetListResponse>;
export type AssetExpenseCategoryTotal = z.infer<typeof assetExpenseCategoryTotal>;
export type AssetFinancialSummary = z.infer<typeof assetFinancialSummary>;
export type AssetRecentActivity = z.infer<typeof assetRecentActivity>;
export type AssetDetail = z.infer<typeof assetDetail>;
