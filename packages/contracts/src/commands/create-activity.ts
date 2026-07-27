import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Every nested id is client-generated (§4.1, §6). An activity captured on a
 * phone with no signal must keep its identity — and the identity of its segment,
 * crew rows and readings — when the envelope finally replays, so the server
 * generates none of them.
 */
export const meterReadingCapture = z.object({
  readingId: z.uuid(),
  readingType: z.enum(["ODOMETER", "HOURS"]),
  /** Kilometres or whole engine-hours, per readingType. */
  value: z.number().int().nonnegative(),
  observedAt: z.iso.datetime({ offset: true }),
});

export const activityCrewMember = z.object({
  activityPersonId: z.uuid(),
  personId: z.uuid(),
  role: z.enum(["DRIVER", "CONDUCTOR", "ASSISTANT", "RELIEF", "MECHANIC", "OTHER"]),
});

export const createActivityPayload = z.object({
  activityId: z.uuid(),
  branchCode: z.string().min(1),
  /** categories.kind = 'ACTIVITY_TYPE' — HAULAGE_JOB, SCHEDULED_JOURNEY, CHARTER. */
  activityTypeCode: z.string().min(1),
  templateCode: z.enum(["TRUCKING", "PASSENGER_TRANSPORT"]),
  /** The asset that starts as carrier; its segment opens with the activity. */
  primarySegmentId: z.uuid(),
  primaryAssetId: z.uuid(),
  startedAt: z.iso.datetime({ offset: true }),
  plannedEndAt: z.iso.datetime({ offset: true }).optional(),
  startReading: meterReadingCapture.optional(),
  crew: z.array(activityCrewMember).max(20).default([]),
  /** Counterparty entity deferred; free text, same as financial entries. */
  customerName: z.string().max(160).optional(),
  /** The job number written on the paper waybill, when it differs from ours. */
  clientReference: z.string().max(60).optional(),
  description: z.string().max(500).optional(),
  customValues: z.record(z.string(), z.unknown()).default({}),
});

export const createActivityCommand = z.object({
  name: z.literal("create-activity"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: createActivityPayload,
});

export type CreateActivityCommand = z.infer<typeof createActivityCommand>;
export type MeterReadingCapture = z.infer<typeof meterReadingCapture>;
export type ActivityCrewMember = z.infer<typeof activityCrewMember>;
