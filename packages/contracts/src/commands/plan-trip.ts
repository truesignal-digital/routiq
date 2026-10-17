import { z } from "zod";
import { commandEnvelope, moneyMinor } from "../envelope.js";
import { legEndpoint } from "./activity-legs.js";
import { activityCrewMember, meterReadingCapture } from "./create-activity.js";

/**
 * Planned trips (ADR-0012). A booking is the trip record itself in a first
 * status, PLANNED; `start-planned-trip` turns the same row into the running
 * trip. These six commands belong to the SCHEDULING module.
 *
 * Every id is client-generated, as in create-activity: an offline `plan-trip`
 * or `start-planned-trip` keeps its identity when it replays.
 */

const plannedAt = z.iso.datetime({ offset: true });
/** Integer XAF (exponent 0). A booking never posts money; the price only pre-fills revenue. */
const priceMinor = moneyMinor.nonnegative().max(Number.MAX_SAFE_INTEGER);
const customerName = z.string().trim().min(1).max(160);
const clientReference = z.string().trim().min(1).max(60);
const description = z.string().trim().min(1).max(500);

function endAfterStart(payload: { plannedStartAt: string; plannedEndAt?: string | undefined }) {
  return (
    payload.plannedEndAt === undefined ||
    Date.parse(payload.plannedEndAt) > Date.parse(payload.plannedStartAt)
  );
}

const endAfterStartIssue = {
  message: "plannedEndAt must fall after plannedStartAt",
  path: ["plannedEndAt"],
};

/**
 * Books a trip. Vehicle and driver may wait for `assign-trip`; the route is
 * what the first leg will be pre-filled with, not a leg.
 */
export const planTripPayload = z
  .object({
    activityId: z.uuid(),
    branchCode: z.string().min(1),
    /** categories.kind = 'ACTIVITY_TYPE' — HAULAGE_JOB, SCHEDULED_JOURNEY, CHARTER. */
    activityTypeCode: z.string().min(1),
    templateCode: z.enum(["TRUCKING", "PASSENGER_TRANSPORT"]),
    plannedStartAt: plannedAt,
    plannedEndAt: plannedAt.optional(),
    plannedAssetId: z.uuid().optional(),
    plannedDriverPersonId: z.uuid().optional(),
    /** Free text until Customers ships (#378), as on create-activity. */
    customerName: customerName.optional(),
    clientReference: clientReference.optional(),
    /** The cargo, or the passengers' charter. */
    description: description.optional(),
    origin: legEndpoint.optional(),
    destination: legEndpoint.optional(),
    agreedPriceMinor: priceMinor.optional(),
    amountToCollectMinor: priceMinor.optional(),
    customValues: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(endAfterStart, endAfterStartIssue);

/**
 * Sets or clears the planned vehicle and driver. Both are always sent: `null`
 * clears one, so the payload states the whole assignment. `expectedVersion`
 * is required.
 */
export const assignTripPayload = z.object({
  activityId: z.uuid(),
  plannedAssetId: z.uuid().nullable(),
  plannedDriverPersonId: z.uuid().nullable(),
});

/**
 * Moves a planned trip. The payload states the new window: leaving out
 * `plannedEndAt` means the trip has no planned end any more. The trip number
 * does not change. `expectedVersion` is required.
 */
export const rescheduleTripPayload = z
  .object({
    activityId: z.uuid(),
    plannedStartAt: plannedAt,
    plannedEndAt: plannedAt.optional(),
  })
  .refine(endAfterStart, endAfterStartIssue);

/**
 * Level 1 edit (ADR-0008) of what a planned trip carries and for whom. Only
 * the fields that change travel: a field left out keeps its value, `null`
 * clears it. `expectedVersion` is required.
 */
export const updatePlannedTripPayload = z
  .object({
    activityId: z.uuid(),
    customerName: customerName.nullable().optional(),
    clientReference: clientReference.nullable().optional(),
    description: description.nullable().optional(),
    origin: legEndpoint.nullable().optional(),
    destination: legEndpoint.nullable().optional(),
    agreedPriceMinor: priceMinor.nullable().optional(),
    amountToCollectMinor: priceMinor.nullable().optional(),
  })
  .refine(
    (payload) => Object.keys(payload).some((key) => key !== "activityId"),
    { message: "nothing to change", path: [] },
  );

export const TRIP_CANCELLATION_REASONS = [
  "CUSTOMER_CANCELLED",
  "NO_VEHICLE_OR_DRIVER",
  "BOOKED_TWICE",
  "OTHER",
] as const;

export type TripCancellationReason = (typeof TRIP_CANCELLATION_REASONS)[number];

/** Calls a planned trip off. The trip stays, with its reason; OTHER needs the person's words. */
export const cancelPlannedTripPayload = z
  .object({
    activityId: z.uuid(),
    reason: z.enum(TRIP_CANCELLATION_REASONS),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .refine((payload) => payload.reason !== "OTHER" || payload.note !== undefined, {
    message: "note is required when the reason is OTHER",
    path: ["note"],
  });

/**
 * PLANNED → OPEN: the truck left. Sets the actual start once and opens the
 * PRIMARY segment on the vehicle that actually left, which the client
 * pre-fills from the plan. Crew and start reading as in create-activity. No
 * `expectedVersion`: a start is a fact, and ADR-0012 §5 settles races.
 */
export const startPlannedTripPayload = z.object({
  activityId: z.uuid(),
  primarySegmentId: z.uuid(),
  primaryAssetId: z.uuid(),
  startedAt: z.iso.datetime({ offset: true }),
  startReading: meterReadingCapture.optional(),
  crew: z.array(activityCrewMember).max(20).default([]),
});

function command<N extends string, P extends z.ZodType>(name: N, payload: P) {
  return z.object({
    name: z.literal(name),
    version: z.literal(1),
    envelope: commandEnvelope,
    payload,
  });
}

export const planTripCommand = command("plan-trip", planTripPayload);
export const assignTripCommand = command("assign-trip", assignTripPayload);
export const rescheduleTripCommand = command("reschedule-trip", rescheduleTripPayload);
export const updatePlannedTripCommand = command("update-planned-trip", updatePlannedTripPayload);
export const cancelPlannedTripCommand = command("cancel-planned-trip", cancelPlannedTripPayload);
export const startPlannedTripCommand = command("start-planned-trip", startPlannedTripPayload);

export type PlanTripPayload = z.infer<typeof planTripPayload>;
export type AssignTripPayload = z.infer<typeof assignTripPayload>;
export type RescheduleTripPayload = z.infer<typeof rescheduleTripPayload>;
export type UpdatePlannedTripPayload = z.infer<typeof updatePlannedTripPayload>;
export type CancelPlannedTripPayload = z.infer<typeof cancelPlannedTripPayload>;
export type StartPlannedTripPayload = z.infer<typeof startPlannedTripPayload>;
export type PlanTripCommand = z.infer<typeof planTripCommand>;
export type StartPlannedTripCommand = z.infer<typeof startPlannedTripCommand>;
