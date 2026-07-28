import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { meterReadingCapture } from "./create-activity.js";

/**
 * A truck fails mid-job and another finishes it. §3.4 invariant 7: the customer
 * keeps one activity, and each asset carries only the distance and cost it
 * actually incurred — which is why the handover readings matter as much as the
 * segment boundary.
 *
 * `expectedVersion` on the envelope refers to the OUTGOING SEGMENT, not the
 * activity: that is the row this command mutates.
 */
export const substituteAssetPayload = z.object({
  activityId: z.uuid(),
  /** Named explicitly rather than inferred, so a stale client cannot close the wrong one. */
  outgoingSegmentId: z.uuid(),
  newSegmentId: z.uuid(),
  substituteAssetId: z.uuid(),
  handoverAt: z.iso.datetime({ offset: true }),
  /** Final meter on the asset stepping out — what its distance is computed from. */
  outgoingReading: meterReadingCapture.optional(),
  /** Opening meter on the asset stepping in. */
  incomingReading: meterReadingCapture.optional(),
  reason: z.string().min(1).max(300).optional(),
});

export const substituteAssetCommand = z.object({
  name: z.literal("substitute-asset"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: substituteAssetPayload,
});

export type SubstituteAssetCommand = z.infer<typeof substituteAssetCommand>;
