import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

export const releaseAssetToServicePayload = z.object({
  assetId: z.uuid(),
  workOrderId: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});

export const releaseAssetToServiceCommand = z.object({
  name: z.literal("release-asset-to-service"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: releaseAssetToServicePayload,
});

export type ReleaseAssetToServiceCommand = z.infer<typeof releaseAssetToServiceCommand>;
