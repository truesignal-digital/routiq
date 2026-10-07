import { z } from "zod";
import { ACTIVITY_COMPLETENESS_CODES } from "../errors.js";
import { listQuery, listResponse } from "./list.js";

export const activityStatuses = ["OPEN", "CLOSED"] as const;
export const activityStatus = z.enum(activityStatuses);

export const activityCompletenessValues = [
  "COMPLETE",
  "COMPLETE_WITH_EXCEPTIONS",
] as const;
export const activityCompleteness = z.enum(activityCompletenessValues);

export const activityListSortFields = ["startedAt", "activityNumber"] as const;

export const activityListQuery = listQuery(
  {
    status: activityStatus.optional(),
    completeness: activityCompleteness.optional(),
    branchId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    activityTypeCode: z.string().min(1).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  },
  { sortFields: activityListSortFields },
).refine(
  ({ from, to }) =>
    from === undefined || to === undefined || new Date(from) <= new Date(to),
  { message: "from must not be after to", path: ["to"] },
);

const activityTypeRead = z.object({
  code: z.string(),
  labelFr: z.string(),
  labelEn: z.string(),
});

export const activityListItem = z.object({
  id: z.uuid(),
  activityNumber: z.string(),
  activityType: activityTypeRead,
  status: activityStatus,
  completeness: activityCompleteness.nullable(),
  completenessCodes: z.array(z.enum(ACTIVITY_COMPLETENESS_CODES)),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  customerName: z.string().nullable(),
  clientReference: z.string().nullable(),
  branchId: z.uuid(),
  primaryAssetCode: z.string().nullable(),
  legCount: z.number().int().nonnegative(),
  crewCount: z.number().int().nonnegative(),
  /** Where the first leg set out from (place name, else the typed text); null without legs. */
  originName: z.string().nullable(),
  /** Where the last leg arrived. */
  destinationName: z.string().nullable(),
  /** Sum of the legs' kilometres; null when no leg carries one. */
  distanceKm: z.number().int().nonnegative().nullable(),
  /** The first DRIVER added to the crew (by name among those added together); null without one. */
  driverName: z.string().nullable(),
});

export const activityListResponse = listResponse(activityListItem);

export const activitySegmentRead = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  assetCode: z.string(),
  role: z.enum(["PRIMARY", "TRAILER", "SUBSTITUTE", "RECOVERY"]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  substitutesSegmentId: z.uuid().nullable(),
  /** substitute-asset locks on the SEGMENT, so its version has to travel with it. */
  rowVersion: z.number().int().positive(),
});

export const activityCrewRead = z.object({
  personId: z.uuid(),
  displayName: z.string(),
  role: z.enum(["DRIVER", "CONDUCTOR", "ASSISTANT", "RELIEF", "MECHANIC", "OTHER"]),
});

export const activityLegRead = z.object({
  id: z.uuid(),
  legNo: z.number().int().positive(),
  segmentId: z.uuid().nullable(),
  originPlaceId: z.uuid().nullable(),
  originName: z.string(),
  destinationPlaceId: z.uuid().nullable(),
  destinationName: z.string(),
  departedAt: z.iso.datetime().nullable(),
  arrivedAt: z.iso.datetime().nullable(),
  distanceKm: z.number().int().nonnegative().nullable(),
  loadState: z.enum(["LADEN", "EMPTY", "PARTIAL"]).nullable(),
  passengerCount: z.number().int().nonnegative().nullable(),
  customValues: z.record(z.string(), z.unknown()),
});

export const activityReadingRead = z.object({
  id: z.uuid(),
  /** Which of the activity's assets the meter belongs to — a job can carry several. */
  assetId: z.uuid(),
  assetCode: z.string(),
  readingType: z.enum(["ODOMETER", "HOURS"]),
  value: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
  source: z.enum([
    "ACTIVITY_START",
    "ACTIVITY_END",
    "SUBSTITUTION",
    "MANUAL",
    "WORK_ORDER",
  ]),
  supersededById: z.uuid().nullable(),
});

export const activityFinancialEntryRead = z.object({
  entryId: z.uuid(),
  entryNumber: z.string(),
  direction: z.enum(["REVENUE", "EXPENSE"]),
  categoryCode: z.string(),
  categoryLabelFr: z.string(),
  categoryLabelEn: z.string(),
  amountMinor: z.number().int(),
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]),
});

export const activityDetail = activityListItem.extend({
  /** Financial commands address branches by code, not id; the detail has to carry it. */
  branchCode: z.string(),
  templateCode: z.enum(["TRUCKING", "PASSENGER_TRANSPORT"]),
  templateVersion: z.number().int().positive(),
  customValues: z.record(z.string(), z.unknown()),
  description: z.string().nullable(),
  plannedStartAt: z.iso.datetime().nullable(),
  plannedEndAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** §3.4 provenance: the command that first wrote the row, shown on the record. */
  createdByCommandId: z.uuid().nullable(),
  /**
   * Who initiated that command. A DRIVER closes, and swaps the vehicle on,
   * only the trips they recorded (OWN_RECORDS_ONLY); the screen reads this to
   * offer those actions only where they will pass.
   */
  recordedByPrincipalId: z.uuid().nullable(),
  rowVersion: z.number().int().positive(),
  segments: z.array(activitySegmentRead),
  crew: z.array(activityCrewRead),
  legs: z.array(activityLegRead),
  readings: z.array(activityReadingRead),
  /**
   * The trip's entries with their amounts, as many as the caller's money
   * scope reads (a driver's own, #264). Null when the caller reads no entries
   * (`canReadEntries`) or FINANCE is off (#103): hidden, never an empty list
   * that would claim the trip had no money.
   */
  financialEntries: z.array(activityFinancialEntryRead).nullable(),
});

const queryBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const personListQuery = z.object({
  branchId: z.uuid().optional(),
  active: queryBoolean.optional(),
  search: z.string().min(1).optional(),
});

export const personListItem = z.object({
  id: z.uuid(),
  displayName: z.string(),
  personCode: z.string().nullable(),
  defaultRole: z
    .enum(["DRIVER", "CONDUCTOR", "ASSISTANT", "RELIEF", "MECHANIC", "CLERK", "OTHER"])
    .nullable(),
  branchId: z.uuid(),
  active: z.boolean(),
});

export const personListResponse = z.object({
  items: z.array(personListItem),
});

export const placeListItem = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const placeListResponse = z.object({
  items: z.array(placeListItem),
});

export type ActivityListQuery = z.infer<typeof activityListQuery>;
export type ActivityListItem = z.infer<typeof activityListItem>;
export type ActivityListResponse = z.infer<typeof activityListResponse>;
export type ActivityDetail = z.infer<typeof activityDetail>;
export type PersonListQuery = z.infer<typeof personListQuery>;
export type PersonListItem = z.infer<typeof personListItem>;
export type PlaceListItem = z.infer<typeof placeListItem>;

/** Narrows the trip counts like the list: inside the caller's scope, never wider. */
export const activitySummaryQuery = z.object({
  branchId: z.uuid().optional(),
});

/**
 * The Trips overview, counted in SQL over the caller's workspace and branch
 * scope. `week` is the current business week (Monday to Sunday, workspace
 * time zone) that `thisWeek` and `weekKm` cover, so a tile can filter the list
 * to exactly the days it counted. `open` and `incomplete` are all-time and
 * equal what `status=OPEN` and `completeness=COMPLETE_WITH_EXCEPTIONS` list.
 * `weekKm` sums the legs that carry a distance; null when none does.
 */
export const activitySummary = z.object({
  week: z.object({ from: z.iso.date(), to: z.iso.date() }),
  thisWeek: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  incomplete: z.number().int().nonnegative(),
  weekKm: z.number().int().nonnegative().nullable(),
});

export type ActivitySummaryQuery = z.infer<typeof activitySummaryQuery>;
export type ActivitySummary = z.infer<typeof activitySummary>;
