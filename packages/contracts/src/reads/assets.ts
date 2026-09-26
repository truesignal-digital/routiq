import { z } from "zod";
import { activityCompleteness, activityStatus } from "./activities.js";
import { historyActor } from "./history.js";
import { listResponse } from "./list.js";
import { issueStatus, workOrderStatus } from "./maintenance.js";

export const assetLifecycleStatuses = [
  "REGISTERED",
  "IN_SERVICE",
  "UNDER_MAINTENANCE",
  "SOLD",
  "RETIRED",
  "WRITTEN_OFF",
] as const;

export const assetLifecycleStatus = z.enum(assetLifecycleStatuses);

/**
 * The statuses the assets screen groups as needing attention. The ATTENTION
 * filter and the summary bucket read the same set, so a tile's number is what
 * filtering on it returns.
 */
export const assetAttentionStatuses = [
  "UNDER_MAINTENANCE",
  "RETIRED",
  "WRITTEN_OFF",
] as const satisfies readonly (typeof assetLifecycleStatuses)[number][];

/** Fields `/v1/assets` may be sorted by; `sort` outside this set is rejected. */
export const assetListSortFields = ["assetCode"] as const;

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

/**
 * Fleet counts aggregated in SQL over the caller's workspace and branch scope,
 * not over the rows a client happens to have paged in. `total` counts every
 * lifecycle status; `inService` and `attention` are the two subsets the list's
 * status filter offers, so each count equals what selecting that filter lists.
 */
export const assetSummary = z.object({
  total: z.number().int().nonnegative(),
  inService: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
});

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

export const METER_READING_TYPES = ["ODOMETER", "HOURS"] as const;
export const meterReadingType = z.enum(METER_READING_TYPES);

export const METER_READING_SOURCES = [
  "ACTIVITY_START",
  "ACTIVITY_END",
  "SUBSTITUTION",
  "MANUAL",
  "WORK_ORDER",
] as const;
export const meterReadingSource = z.enum(METER_READING_SOURCES);

/**
 * The workspace member answerable for the vehicle. A member, not a Person: the
 * custodian is who the office calls, and a driver without a login cannot hold
 * the role. No phone and no role — neither is part of the custody model.
 */
export const assetCustodian = z.object({
  membershipId: z.uuid(),
  displayName: z.string(),
  /** False once the membership is deactivated; the asset still names them. */
  active: z.boolean(),
  /** When the custody last changed to this member; null if no assignment event names it. */
  since: z.iso.datetime().nullable(),
});

/** A work order answering the grounding signalement, with its makers for the client's lock reasons. */
export const availabilityWorkOrder = z.object({
  id: z.uuid(),
  status: workOrderStatus,
  rowVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  createdBy: historyActor,
  /** Who declared the work complete (COMPLETION_SUBMITTED or COMPLETED); null before that. */
  completedBy: historyActor.nullable(),
});

/**
 * Whether the vehicle may be used, which is not its lifecycle status. Read from
 * the availability intervals, so only the MAINTENANCE module can say it:
 * with the module off the answer is NOT_ASSESSED, never a silent AVAILABLE.
 */
export const assetAvailability = z.discriminatedUnion("state", [
  z.object({ state: z.literal("NOT_ASSESSED") }),
  z.object({
    state: z.literal("AVAILABLE"),
    /** When the last grounding ended; null if the vehicle was never grounded. */
    since: z.iso.datetime().nullable(),
  }),
  z.object({
    state: z.literal("GROUNDED"),
    since: z.iso.datetime(),
    intervalId: z.uuid(),
    intervalRowVersion: z.number().int().positive(),
    issue: z.object({
      id: z.uuid(),
      description: z.string(),
      safetyCritical: z.boolean(),
      category: z.string().nullable(),
      status: issueStatus,
      rowVersion: z.number().int().positive(),
      reportedAt: z.iso.datetime(),
      reportedBy: historyActor,
      /** Who resolved or dismissed the signalement; null while it is OPEN. */
      closedBy: historyActor.nullable(),
    }),
    /** Work orders on the grounding signalement, newest first. */
    workOrders: z.array(availabilityWorkOrder),
  }),
]);

/** The newest current reading: ODOMETER when the vehicle has one, else HOURS. */
export const assetLastReading = z.object({
  id: z.uuid(),
  readingType: meterReadingType,
  value: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
  source: meterReadingSource,
  activityId: z.uuid().nullable(),
  recordedBy: historyActor,
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
  /**
   * Absent for roles outside FINANCE_READER_ROLES (MAINTENANCE): the workshop
   * sees the cost lines of its own work orders, never the vehicle's ledger.
   */
  finance: assetFinancialSummary.optional(),
  recentActivities: z.array(assetRecentActivity),
  custodian: assetCustodian.nullable(),
  availability: assetAvailability,
  /** Null with ACTIVITIES disabled — readings belong to that module. */
  lastReading: assetLastReading.nullable(),
});

export type AssetLifecycleStatus = z.infer<typeof assetLifecycleStatus>;
export type AssetListSortField = (typeof assetListSortFields)[number];
export type AssetListItem = z.infer<typeof assetListItem>;
export type AssetListResponse = z.infer<typeof assetListResponse>;
export type AssetSummary = z.infer<typeof assetSummary>;
export type AssetExpenseCategoryTotal = z.infer<typeof assetExpenseCategoryTotal>;
export type AssetFinancialSummary = z.infer<typeof assetFinancialSummary>;
export type AssetRecentActivity = z.infer<typeof assetRecentActivity>;
export type MeterReadingType = z.infer<typeof meterReadingType>;
export type MeterReadingSource = z.infer<typeof meterReadingSource>;
export type AssetCustodian = z.infer<typeof assetCustodian>;
export type AvailabilityWorkOrder = z.infer<typeof availabilityWorkOrder>;
export type AssetAvailability = z.infer<typeof assetAvailability>;
export type AssetLastReading = z.infer<typeof assetLastReading>;
export type AssetDetail = z.infer<typeof assetDetail>;
