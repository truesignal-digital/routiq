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
  amountMinor: z.number().int(),
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]),
});

export const activityDetail = activityListItem.extend({
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
  rowVersion: z.number().int().positive(),
  segments: z.array(activitySegmentRead),
  crew: z.array(activityCrewRead),
  legs: z.array(activityLegRead),
  readings: z.array(activityReadingRead),
  financialEntries: z.array(activityFinancialEntryRead),
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
