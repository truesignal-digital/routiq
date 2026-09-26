import { z } from "zod";
import { COMMAND_ORIGINS } from "../envelope.js";
import { ROLES } from "../roles.js";
import { meterReadingSource, meterReadingType } from "./assets.js";
import { historyActor } from "./history.js";
import { listQuery, listResponse } from "./list.js";

/**
 * Reads behind the vehicle workspace (#44). Every one of them is scoped through
 * the vehicle: an asset outside the caller's workspace or branches answers 404
 * REFERENCE_NOT_FOUND, and a disabled owning module answers 403 MODULE_DISABLED.
 */

/** Newest first, fixed server-side; the cursor carries that order. */
export const assetReadingsQuery = listQuery({
  readingType: meterReadingType.optional(),
});

/**
 * One observation. Superseded rows are listed and flagged, not hidden: a
 * correction is part of the meter's story, and the client computes deltas over
 * the current ones.
 */
export const assetReadingItem = z.object({
  id: z.uuid(),
  readingType: meterReadingType,
  value: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
  source: meterReadingSource,
  activityId: z.uuid().nullable(),
  activityNumber: z.string().nullable(),
  supersededById: z.uuid().nullable(),
  /** Why this reading was corrected; set on the superseded row. */
  supersedeReason: z.string().nullable(),
  recordedBy: historyActor,
  origin: z.enum(COMMAND_ORIGINS),
});

export const assetReadingsResponse = listResponse(assetReadingItem);

/**
 * A member who may hold the vehicle: an active membership whose branch scope
 * covers the vehicle's branch — the same rule `assign-asset` enforces with
 * CUSTODIAN_INELIGIBLE. People without a login are not members and never appear.
 */
export const custodianCandidate = z.object({
  membershipId: z.uuid(),
  displayName: z.string(),
  role: z.enum(ROLES),
});

export const custodianCandidatesResponse = z.object({
  items: z.array(custodianCandidate),
});

export type AssetReadingsQuery = z.infer<typeof assetReadingsQuery>;
export type AssetReadingItem = z.infer<typeof assetReadingItem>;
export type AssetReadingsResponse = z.infer<typeof assetReadingsResponse>;
export type CustodianCandidate = z.infer<typeof custodianCandidate>;
export type CustodianCandidatesResponse = z.infer<typeof custodianCandidatesResponse>;
