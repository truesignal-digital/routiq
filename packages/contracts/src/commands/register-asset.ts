import { z } from "zod";
import { commandEnvelope, moneyMinor } from "../envelope.js";

export const registerAssetPayload = z.object({
  assetId: z.uuid(),
  assetCode: z.string().min(1).max(40),
  assetClassCode: z.string().min(1),
  templateCode: z.enum(["TRUCKING", "PASSENGER_TRANSPORT"]),
  branchCode: z.string().min(1),
  registrationNumber: z.string().max(40).optional(),
  chassisNumber: z.string().max(60).optional(),
  manufacturer: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  modelYear: z.number().int().min(1950).max(2100).optional(),
  acquisitionDate: z.iso.date().optional(),
  acquisitionAmountMinor: moneyMinor.nonnegative().optional(),
  capacityValue: z.number().positive().optional(),
  capacityUnit: z.enum(["KG", "TONNE", "M3", "SEAT"]).optional(),
  customValues: z.record(z.string(), z.unknown()).default({}),
});

export const registerAssetCommand = z.object({
  name: z.literal("register-asset"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: registerAssetPayload,
});

export type RegisterAssetCommand = z.infer<typeof registerAssetCommand>;
