import { z } from "zod";
import { TRIP_CANCELLATION_REASONS } from "../commands/plan-trip.js";
import { TRIP_CONFLICT_CODES, TRIP_DISCREPANCY_CODES } from "../errors.js";
import { activityStatus, tripPriceFields } from "./activities.js";

/** A month grid of six weeks fits; the range is the read's only bound (no paging). */
export const PLANNING_MAX_DAYS = 42;

/** Calendar days from `from` to `to`, both counted. ISO dates have no zone, so UTC math is exact. */
export function planningRangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * `GET /v1/planning` (ADR-0012 §7, #336). `from` and `to` are business dates
 * in the workspace time zone, both inclusive, at most `PLANNING_MAX_DAYS`
 * days. The filters narrow inside the caller's branches, never past them.
 */
export const planningQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    branchId: z.uuid().optional(),
    /** Trips planned on or carried by this vehicle; the vehicles list narrows to it. */
    assetId: z.uuid().optional(),
    /** Trips planned for or driven by this person; the drivers list narrows to them. */
    personId: z.uuid().optional(),
    /** Part of the customer's name, any case. */
    customer: z.string().trim().min(1).max(120).optional(),
    /** Cancelled bookings are left out unless asked. */
    includeCancelled: queryBoolean.optional(),
  })
  // ISO dates order as strings.
  .refine(({ from, to }) => from <= to, { message: "from must not be after to", path: ["to"] })
  .refine(({ from, to }) => planningRangeDays(from, to) <= PLANNING_MAX_DAYS, {
    message: `at most ${PLANNING_MAX_DAYS} days`,
    path: ["to"],
  });

const actorAt = z.object({
  /** Null when the actor cannot be named to this tenant (a vendor operator). */
  displayName: z.string().nullable(),
  at: z.iso.datetime(),
});

export const planningTrip = z.object({
  id: z.uuid(),
  activityNumber: z.string(),
  status: activityStatus,
  templateCode: z.enum(["TRUCKING", "PASSENGER_TRANSPORT"]),
  activityType: z.object({ code: z.string(), labelFr: z.string(), labelEn: z.string() }),
  branchId: z.uuid(),
  customerName: z.string().nullable(),
  clientReference: z.string().nullable(),
  /** The cargo or the job, as booked. */
  description: z.string().nullable(),
  plannedStartAt: z.iso.datetime().nullable(),
  plannedEndAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  /**
   * Where the board lays the trip (ADR-0012 §4). PLANNED and CANCELLED: the
   * planned start to the planned end, else to the end of that business day.
   * OPEN: the start to the later of the planned end and now. CLOSED: the
   * start to the end.
   */
  window: z.object({ start: z.iso.datetime(), end: z.iso.datetime() }),
  /** The first leg's origin and the last leg's destination once there are legs, else the planned route. */
  originName: z.string().nullable(),
  destinationName: z.string().nullable(),
  /** The planned vehicle until the trip starts, then the vehicle that carries it. */
  vehicle: z.object({ id: z.uuid(), assetCode: z.string(), planned: z.boolean() }).nullable(),
  /** The planned driver until the trip starts, then the first DRIVER on the crew. */
  driver: z.object({ personId: z.uuid(), displayName: z.string(), planned: z.boolean() }).nullable(),
  /** Recomputed on every read for PLANNED and OPEN trips; never stored. */
  conflicts: z.array(z.enum(TRIP_CONFLICT_CODES)),
  discrepancyCodes: z.array(z.enum(TRIP_DISCREPANCY_CODES)),
  /** Who booked it; null for a trip recorded once it had started. */
  plannedBy: actorAt.nullable(),
  /** The latest reassignment or move, for the driver's "Changed" badge. */
  lastChange: actorAt.extend({ kind: z.enum(["ASSIGNED", "RESCHEDULED"]) }).nullable(),
  cancellation: z
    .object({
      at: z.iso.datetime(),
      reason: z.enum(TRIP_CANCELLATION_REASONS),
      note: z.string().nullable(),
    })
    .nullable(),
  priceCurrency: z.string().length(3),
  ...tripPriceFields,
});

export const planningBlock = z.object({
  /** The availability interval that grounds the vehicle. */
  id: z.uuid(),
  from: z.iso.datetime(),
  /** Null while the vehicle is still grounded. */
  to: z.iso.datetime().nullable(),
  /** The problem that grounded it. */
  issueId: z.uuid(),
  /**
   * The latest work order on that problem, null when none was raised. Work
   * orders carry no number yet, so the board links to it by id.
   */
  workOrderId: z.uuid().nullable(),
});

export const planningVehicle = z.object({
  id: z.uuid(),
  assetCode: z.string(),
  registrationNumber: z.string().nullable(),
  branchId: z.uuid(),
  /**
   * Grounded intervals overlapping the range. Null when MAINTENANCE is off:
   * availability unknown, never an empty list that would claim none.
   */
  blocks: z.array(planningBlock).nullable(),
});

export const planningDriver = z.object({
  personId: z.uuid(),
  displayName: z.string(),
  personCode: z.string().nullable(),
  branchId: z.uuid(),
});

/** One business day. A trip whose window spans days counts on each of them. */
export const planningDay = z.object({
  date: z.iso.date(),
  /** PLANNED trips on the day. */
  planned: z.number().int().nonnegative(),
  /** PLANNED trips on the day still missing a vehicle or a driver. */
  toAssign: z.number().int().nonnegative(),
  /** PLANNED or OPEN trips on the day with at least one conflict. */
  conflicts: z.number().int().nonnegative(),
});

export const planningSummary = z.object({
  /** Distinct trips over the whole range, by the day counts' rules. */
  planned: z.number().int().nonnegative(),
  toAssign: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  /** Vehicles in the list on at least one PLANNED or OPEN trip in the range. */
  vehiclesBooked: z.number().int().nonnegative(),
  vehiclesTotal: z.number().int().nonnegative(),
  /** The workspace currency `plannedRevenueMinor` is counted in. */
  currency: z.string().length(3),
  /**
   * The agreed prices of the PLANNED trips in the range priced in `currency`;
   * OPEN, CLOSED and CANCELLED trips are not summed. Present only for the
   * roles that read the ledger, with FINANCE on.
   */
  plannedRevenueMinor: z.number().int().nonnegative().optional(),
});

export const planningResponse = z.object({
  range: z.object({ from: z.iso.date(), to: z.iso.date(), timezone: z.string() }),
  /** Window start, then trip number, then id. */
  trips: z.array(planningTrip),
  vehicles: z.array(planningVehicle),
  drivers: z.array(planningDriver),
  days: z.array(planningDay),
  summary: planningSummary,
});

export type PlanningQuery = z.infer<typeof planningQuery>;
export type PlanningTrip = z.infer<typeof planningTrip>;
export type PlanningVehicle = z.infer<typeof planningVehicle>;
export type PlanningDriver = z.infer<typeof planningDriver>;
export type PlanningDay = z.infer<typeof planningDay>;
export type PlanningSummary = z.infer<typeof planningSummary>;
export type PlanningResponse = z.infer<typeof planningResponse>;
