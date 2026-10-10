import { z } from "zod";
import { TRIP_CANCELLATION_REASONS } from "../commands/plan-trip.js";
import { ACTIVITY_COMPLETENESS_CODES, TRIP_DISCREPANCY_CODES } from "../errors.js";
import { entryCancellation } from "./finance.js";
import { listQuery, listResponse } from "./list.js";

/**
 * A trip's lifecycle (ADR-0012): PLANNED and CANCELLED come with Scheduling
 * and carry no actual start. The trip reads that predate it list only the
 * started ones unless asked (`STARTED_ACTIVITY_STATUSES`).
 */
export const activityStatuses = ["PLANNED", "OPEN", "CLOSED", "CANCELLED"] as const;
export const activityStatus = z.enum(activityStatuses);
export type ActivityStatus = (typeof activityStatuses)[number];

/**
 * What `/v1/activities`, its summary and a vehicle's recent trips return when
 * no status is asked for (ADR-0012 §7): trips that have started, so a client
 * built before Scheduling never meets a trip with no start date.
 */
export const STARTED_ACTIVITY_STATUSES = ["OPEN", "CLOSED"] as const satisfies readonly ActivityStatus[];

export const activityCompletenessValues = [
  "COMPLETE",
  "COMPLETE_WITH_EXCEPTIONS",
] as const;
export const activityCompleteness = z.enum(activityCompletenessValues);

export const activityListSortFields = ["startedAt", "activityNumber"] as const;

export const activityListQuery = listQuery(
  {
    /** Absent: OPEN and CLOSED only. PLANNED and CANCELLED are listed when asked by name. */
    status: activityStatus.optional(),
    completeness: activityCompleteness.optional(),
    branchId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    activityTypeCode: z.string().min(1).optional(),
    /**
     * Calendar days on `startedAt`, both inclusive, in the workspace time zone:
     * the same days the summary's `week` names, so a tile and the list it
     * filters count the same trips (#511).
     */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    /**
     * Closed trips missing fuel or km (ACTIVITY_MISSING_FILTERS); lists CLOSED
     * trips only, so with any other `status` both apply and nothing lists.
     * `fuel` while Money (FINANCE) is off is 400 VALIDATION_FAILED: not
     * counted, so not filterable.
     */
    missing: z.enum(["fuel", "km"]).optional(),
  },
  { sortFields: activityListSortFields },
).refine(
  // ISO dates order as strings.
  ({ from, to }) => from === undefined || to === undefined || from <= to,
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
  /** Set on a cancellation: the entry it cancels, so the card can fold the pair (#427). */
  reversesEntryId: z.uuid().nullable(),
  /** On an original: its posted cancellation. A trip's money is one window, so always folded. */
  cancelledBy: entryCancellation.nullable(),
});

/**
 * The agreed price and the amount to collect (ADR-0012 §7), minor units of
 * `priceCurrency`. Present only for the roles that read the ledger, with
 * FINANCE on (`tripPricesVisible` on the server); every other caller gets the
 * keys omitted, never null and never 0. Null means none was agreed.
 */
export const tripPriceFields = {
  agreedPriceMinor: z.number().int().nonnegative().nullable().optional(),
  amountToCollectMinor: z.number().int().nonnegative().nullable().optional(),
};

/** The plan of a trip (ADR-0012), beside the facts: who and what the office booked. */
const tripPlanFields = {
  plannedAsset: z.object({ id: z.uuid(), assetCode: z.string() }).nullable(),
  plannedDriver: z.object({ personId: z.uuid(), displayName: z.string() }).nullable(),
  /** The planned route's ends (place name, else the typed text); not legs. */
  plannedOriginName: z.string().nullable(),
  plannedDestinationName: z.string().nullable(),
  /** Kept with its reason once cancelled, and still there if a late start revived it. */
  cancellation: z
    .object({
      at: z.iso.datetime(),
      reason: z.enum(TRIP_CANCELLATION_REASONS),
      note: z.string().nullable(),
    })
    .nullable(),
  discrepancyCodes: z.array(z.enum(TRIP_DISCREPANCY_CODES)),
  priceCurrency: z.string().length(3),
  ...tripPriceFields,
};

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
  ...tripPlanFields,
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
  /** The login linked to this person (`link-person-login`), by principal id; null when none. */
  loginPrincipalId: z.uuid().nullable(),
  /** The person's, so a row action can send it as expectedVersion. */
  rowVersion: z.number().int().positive(),
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

/** How many business weeks the Trips Overview's chart covers, the current one last. */
export const ACTIVITY_OVERVIEW_WEEKS = 12;

/**
 * What a closed trip can be missing, as the Trips list filters it (#665):
 * `fuel`, no fuel expense (category FUEL) waiting or posted on the trip;
 * `km`, no leg that records a distance. Both list CLOSED trips only.
 */
export const ACTIVITY_MISSING_FILTERS = ["fuel", "km"] as const;
export type ActivityMissingFilter = (typeof ACTIVITY_MISSING_FILTERS)[number];

/**
 * The Trips overview, counted in SQL over the caller's workspace and branch
 * scope. `week` is the current business week (Monday to Sunday, workspace
 * time zone) that `thisWeek`, `weekClosed` and `weekKm` cover, so a tile can
 * filter the list to exactly the days it counted. `open` and `incomplete` are
 * all-time and equal what `status=OPEN` and
 * `completeness=COMPLETE_WITH_EXCEPTIONS` list. `weekKm` sums the legs that
 * carry a distance; null when none does.
 *
 * Built inside a pure call: the web reads it by its type only.
 */
export const activitySummary = /* @__PURE__ */ (() =>
  z.object({
    week: z.object({ from: z.iso.date(), to: z.iso.date() }),
    thisWeek: z.number().int().nonnegative(),
    /** Of `thisWeek`, the trips now CLOSED: what `status=CLOSED&from&to` lists for the week. */
    weekClosed: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    /** The open trip that started first; null when none is open. */
    oldestOpen: z
      .object({
        id: z.uuid(),
        activityNumber: z.string(),
        startedAt: z.iso.datetime(),
        /** The vehicle on its first segment; null when it has none. */
        assetCode: z.string().nullable(),
      })
      .nullable(),
    incomplete: z.number().int().nonnegative(),
    /**
     * Closed trips (all-time) missing a fact, each equal to what
     * `missing=fuel` and `missing=km` list. `fuel` is null while Money is off:
     * fuel is a money fact, so it is not counted rather than counted as none.
     */
    closedMissing: z.object({
      fuel: z.number().int().nonnegative().nullable(),
      km: z.number().int().nonnegative(),
    }),
    weekKm: z.number().int().nonnegative().nullable(),
    /**
     * Started trips per business week, oldest first, the current (partial)
     * week last; `closed` is how many of them are now closed. Zero-filled.
     */
    weeks: z
      .array(
        z.object({
          from: z.iso.date(),
          to: z.iso.date(),
          started: z.number().int().nonnegative(),
          closed: z.number().int().nonnegative(),
        }),
      )
      .length(ACTIVITY_OVERVIEW_WEEKS),
  }))();

export type ActivitySummaryQuery = z.infer<typeof activitySummaryQuery>;
export type ActivitySummary = z.infer<typeof activitySummary>;
