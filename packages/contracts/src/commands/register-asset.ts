import { z } from "zod";
import { commandEnvelope, moneyMinor } from "../envelope.js";
import { assetIdentityFields } from "./asset-identity.js";

/** One registration shape; the versions differ only in the plate and chassis rules. */
function registerAssetShape<Plate extends z.ZodType, Chassis extends z.ZodType>(identity: {
  registrationNumber: Plate;
  chassisNumber: Chassis;
}) {
  return z.object({
    assetId: z.uuid(),
    assetCode: z.string().min(1).max(40),
    assetClassCode: z.string().min(1),
    templateCode: z.enum(["TRUCKING", "PASSENGER_TRANSPORT"]),
    branchCode: z.string().min(1),
    registrationNumber: identity.registrationNumber.optional(),
    chassisNumber: identity.chassisNumber.optional(),
    manufacturer: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
    modelYear: z.number().int().min(1950).max(2100).optional(),
    acquisitionDate: z.iso.date().optional(),
    acquisitionAmountMinor: moneyMinor.nonnegative().optional(),
    capacityValue: z.number().positive().optional(),
    capacityUnit: z.enum(["KG", "TONNE", "M3", "SEAT"]).optional(),
    customValues: z.record(z.string(), z.unknown()).default({}),
  });
}

/**
 * v2 (#122): the plate and chassis number follow the same rules as the Details
 * edit (`assetIdentityFields`), and the handler refuses a plate another vehicle
 * in the workspace already carries. A vehicle can no longer be registered with
 * a value its own Details card would refuse.
 */
export const registerAssetPayload = registerAssetShape(assetIdentityFields);

export const registerAssetCommand = z.object({
  name: z.literal("register-asset"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: registerAssetPayload,
});

/**
 * v1, frozen as shipped: an untrimmed plate up to 40 characters and a chassis
 * number up to 60, no duplicate-plate check. Kept registered so a client or a
 * queued envelope still posting v1 keeps working; what it lets in, the Details
 * edit never re-checks unless that field itself is changed.
 */
export const registerAssetV1Payload = /* @__PURE__ */ registerAssetShape({
  registrationNumber: z.string().max(40),
  chassisNumber: z.string().max(60),
});

export const registerAssetV1Command = /* @__PURE__ */ z.object({
  name: z.literal("register-asset"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: registerAssetV1Payload,
});

export type RegisterAssetPayload = z.infer<typeof registerAssetPayload>;
export type RegisterAssetV1Payload = z.infer<typeof registerAssetV1Payload>;
export type RegisterAssetCommand = z.infer<typeof registerAssetCommand>;
