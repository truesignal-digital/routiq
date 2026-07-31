import { z } from "zod";
import { commandEnvelope, moneyMinor } from "../envelope.js";
import { activityCrewMember, meterReadingCapture } from "./create-activity.js";
import { legEndpoint } from "./activity-legs.js";

/**
 * A money line inside a sheet. It borrows the standalone entry's shape rather
 * than inventing one: the same tenant threshold decides it, and §3.4 invariant 5
 * allows exactly one canonical posting per economic fact.
 */
export const sheetEntry = z.object({
  entryId: z.uuid(),
  direction: z.enum(["REVENUE", "EXPENSE"]),
  categoryCode: z.string().min(1),
  amountMinor: moneyMinor.positive(),
  economicDate: z.iso.date(),
  paymentMethod: z.enum(["CASH", "MOMO", "OM", "BANK", "OTHER"]).default("CASH"),
  paymentReference: z.string().max(80).optional(),
  description: z.string().max(300).optional(),
  counterpartyName: z.string().max(160).optional(),
  /** Attribute the cost to a specific asset — a fuel purchase belongs to a truck. */
  assetId: z.uuid().optional(),
  /** Crew pay carries the person; that is what makes §9 report 8 a query. */
  personId: z.uuid().optional(),
  /**
   * Repairs to the asset that failed stay direct to the asset and OFF the job
   * (§3.4 inv. 7) — charging them to the trip would hide a truck starting to
   * cost money behind a haul that went fine.
   */
  attributeToActivity: z.boolean().default(true),
});

export const sheetLeg = z.object({
  legId: z.uuid(),
  legNo: z.number().int().positive(),
  segmentId: z.uuid().optional(),
  origin: legEndpoint,
  destination: legEndpoint,
  departedAt: z.iso.datetime({ offset: true }).optional(),
  arrivedAt: z.iso.datetime({ offset: true }).optional(),
  distanceKm: z.number().int().nonnegative().optional(),
  loadState: z.enum(["LADEN", "EMPTY", "PARTIAL"]).optional(),
  passengerCount: z.number().int().nonnegative().optional(),
});

/** Extra carriers or trailers running alongside the primary asset. */
export const sheetSegment = z.object({
  segmentId: z.uuid(),
  assetId: z.uuid(),
  role: z.enum(["TRAILER", "RECOVERY"]),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).optional(),
});

const sheetBase = {
  activityId: z.uuid(),
  branchCode: z.string().min(1),
  activityTypeCode: z.string().min(1),
  primarySegmentId: z.uuid(),
  primaryAssetId: z.uuid(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  startReading: meterReadingCapture.optional(),
  endReading: meterReadingCapture.optional(),
  crew: z.array(activityCrewMember).max(20).default([]),
  legs: z.array(sheetLeg).max(50).default([]),
  extraSegments: z.array(sheetSegment).max(10).default([]),
  entries: z.array(sheetEntry).max(50).default([]),
  customerName: z.string().max(160).optional(),
  clientReference: z.string().max(60).optional(),
  description: z.string().max(500).optional(),
  customValues: z.record(z.string(), z.unknown()).default({}),
  /**
   * Whether this submission also closes the activity. Recording a sheet states
   * facts; closing is a human decision about whether the record is finished, and
   * the two are not the same act — a field agent transcribing what happened must
   * not find the trip declared "clôturée avec réserves" behind their back. Hence
   * the default: record open, close only when asked. The office clerk copying a
   * finished paper sheet sends `true` and gets the completeness verdict.
   */
  close: z.boolean().default(false),
};

/**
 * The passenger flavour. Deliberately its own schema rather than a shared
 * all-optional union: a journey has seats and a haulage job has cargo, and
 * collapsing them would push the difference into runtime branching — which is
 * the configuration engine decision #1 refuses to build. What is shared is the
 * writer underneath, not the shape on top.
 */
export const recordJourneySheetPayload = z.object({
  ...sheetBase,
  seatsSold: z.number().int().nonnegative().optional(),
  seatsAvailable: z.number().int().positive().optional(),
});

export const recordJourneySheetCommand = z.object({
  name: z.literal("record-journey-sheet"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: recordJourneySheetPayload,
});

/** The haulage flavour: cargo instead of seats, tractor plus trailer. */
export const recordHaulageJobSheetPayload = z.object({
  ...sheetBase,
  cargoDescription: z.string().max(300).optional(),
  cargoWeightKg: z.number().int().nonnegative().optional(),
});

export const recordHaulageJobSheetCommand = z.object({
  name: z.literal("record-haulage-job-sheet"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: recordHaulageJobSheetPayload,
});

export type RecordJourneySheetCommand = z.infer<typeof recordJourneySheetCommand>;
export type RecordHaulageJobSheetCommand = z.infer<typeof recordHaulageJobSheetCommand>;
export type SheetEntry = z.infer<typeof sheetEntry>;
export type SheetLeg = z.infer<typeof sheetLeg>;
export type SheetSegment = z.infer<typeof sheetSegment>;
