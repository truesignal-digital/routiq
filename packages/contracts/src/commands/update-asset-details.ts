import { z } from "zod";
import { commandEnvelope, moneyMinor } from "../envelope.js";
import { assetIdentityFields } from "./asset-identity.js";

/** The oldest model year a vehicle may carry. */
export const MODEL_YEAR_MIN = 1950;

/** Next year: a model year runs ahead of the calendar, never further. */
export function latestModelYear(now: Date = new Date()): number {
  return now.getUTCFullYear() + 1;
}

/**
 * The descriptive fields of a vehicle, one rule each, shared by the command and
 * by the Details card's edit mode so a value the card accepts is a value the
 * server accepts. The plate and chassis number are register-asset's own rules
 * (`asset-identity.ts`). Text is trimmed before its length is checked; clearing a
 * field is `null`, never an empty string.
 */
export const assetDetailFields = {
  registrationNumber: assetIdentityFields.registrationNumber,
  manufacturer: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  modelYear: z
    .number()
    .int()
    .min(MODEL_YEAR_MIN)
    .refine((year) => year <= latestModelYear(), { error: "MODEL_YEAR_TOO_LATE" }),
  chassisNumber: assetIdentityFields.chassisNumber,
  /** Not in the future: the server checks that against the workspace's business date. */
  acquisitionDate: z.iso.date(),
  acquisitionAmountMinor: moneyMinor.nonnegative(),
  /** One template specification value; `null` clears it. */
  customValue: z.union([z.string().trim().min(1).max(120), z.number(), z.boolean(), z.null()]),
} as const;

export const ASSET_DETAIL_FIELDS = [
  "registrationNumber",
  "manufacturer",
  "model",
  "modelYear",
  "chassisNumber",
  "acquisitionDate",
  "acquisitionAmountMinor",
  "customValues",
] as const;

export type AssetDetailField = (typeof ASSET_DETAIL_FIELDS)[number];

/**
 * Level 1 of ADR-0008: a plain edit of what the vehicle is. Only the fields
 * that changed travel; a field left out keeps its value, `null` clears it.
 * `customValues` is a patch too: its keys are the template's own fields, and a
 * key left out keeps its value.
 *
 * Deliberately absent: the fleet code (it is on printed paperwork and in record
 * numbers), the class and template (they decide which specifications exist),
 * and everything the vehicle's own actions change (branch, custodian,
 * lifecycle, availability, readings). `expectedVersion` is required.
 */
export const updateAssetDetailsPayload = z
  .strictObject({
    assetId: z.uuid(),
    registrationNumber: assetDetailFields.registrationNumber.nullable().optional(),
    manufacturer: assetDetailFields.manufacturer.nullable().optional(),
    model: assetDetailFields.model.nullable().optional(),
    modelYear: assetDetailFields.modelYear.nullable().optional(),
    chassisNumber: assetDetailFields.chassisNumber.nullable().optional(),
    acquisitionDate: assetDetailFields.acquisitionDate.nullable().optional(),
    acquisitionAmountMinor: assetDetailFields.acquisitionAmountMinor.nullable().optional(),
    customValues: z.record(z.string().min(1).max(60), assetDetailFields.customValue).optional(),
  })
  .refine(
    (payload) =>
      ASSET_DETAIL_FIELDS.some((field) =>
        field === "customValues"
          ? payload.customValues !== undefined && Object.keys(payload.customValues).length > 0
          : payload[field] !== undefined,
      ),
    { error: "NO_CHANGES" },
  );

export const updateAssetDetailsCommand = z.strictObject({
  name: z.literal("update-asset-details"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: updateAssetDetailsPayload,
});

export type UpdateAssetDetailsPayload = z.infer<typeof updateAssetDetailsPayload>;
export type UpdateAssetDetailsCommand = z.infer<typeof updateAssetDetailsCommand>;
