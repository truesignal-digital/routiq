import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * A leg endpoint is a reusable place or an ad-hoc stop. §3.1 asks for a minimal
 * places table "so route profitability doesn't degrade to string matching", with
 * free text as the fallback — the discriminator makes the clerk's intent
 * explicit rather than guessing from which field is filled.
 */
export const legEndpoint = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("place"),
    /** Used only if this name is new to the workspace; resolution is by name. */
    placeId: z.uuid(),
    name: z.string().min(1).max(120),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(160),
  }),
]);

export const recordMovementLegPayload = z.object({
  legId: z.uuid(),
  activityId: z.uuid(),
  /** Client-assigned so replay is deterministic; unique per activity. */
  legNo: z.number().int().positive(),
  /** The carrier segment that ran this leg. */
  segmentId: z.uuid().optional(),
  origin: legEndpoint,
  destination: legEndpoint,
  departedAt: z.iso.datetime({ offset: true }).optional(),
  arrivedAt: z.iso.datetime({ offset: true }).optional(),
  distanceKm: z.number().int().nonnegative().optional(),
  loadState: z.enum(["LADEN", "EMPTY", "PARTIAL"]).optional(),
  passengerCount: z.number().int().nonnegative().optional(),
  customValues: z.record(z.string(), z.unknown()).default({}),
});

export const recordMovementLegCommand = z.object({
  name: z.literal("record-movement-leg"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: recordMovementLegPayload,
});

/**
 * Capture or correct an observation. Readings are immutable (§3.1): a correction
 * inserts a new row and stamps the original's superseded_by_id, so the original
 * observation survives exactly as it was recorded.
 */
export const recordMeterReadingPayload = z
  .object({
    readingId: z.uuid(),
    assetId: z.uuid(),
    readingType: z.enum(["ODOMETER", "HOURS"]),
    value: z.number().int().nonnegative(),
    observedAt: z.iso.datetime({ offset: true }),
    source: z
      .enum(["ACTIVITY_START", "ACTIVITY_END", "SUBSTITUTION", "MANUAL", "WORK_ORDER"])
      .default("MANUAL"),
    activityId: z.uuid().optional(),
    supersedesReadingId: z.uuid().optional(),
    supersedeReason: z.string().min(1).max(300).optional(),
  })
  .refine(
    (payload) =>
      payload.supersedesReadingId === undefined || payload.supersedeReason !== undefined,
    { message: "supersedeReason is required when superseding", path: ["supersedeReason"] },
  );

export const recordMeterReadingCommand = z.object({
  name: z.literal("record-meter-reading"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: recordMeterReadingPayload,
});

export type RecordMovementLegCommand = z.infer<typeof recordMovementLegCommand>;
export type RecordMeterReadingCommand = z.infer<typeof recordMeterReadingCommand>;
export type LegEndpoint = z.infer<typeof legEndpoint>;
