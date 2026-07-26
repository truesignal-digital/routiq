import { z } from "zod";
import { listResponse } from "./list.js";

export const assetLifecycleStatuses = [
  "REGISTERED",
  "IN_SERVICE",
  "UNDER_MAINTENANCE",
  "SOLD",
  "RETIRED",
  "WRITTEN_OFF",
] as const;

export const assetLifecycleStatus = z.enum(assetLifecycleStatuses);

export const assetListItem = z.object({
  id: z.uuid(),
  assetCode: z.string(),
  registrationNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  lifecycleStatus: assetLifecycleStatus,
  rowVersion: z.number(),
  category: z.object({
    code: z.string(),
    labelFr: z.string(),
    labelEn: z.string(),
  }),
  branch: z.object({
    code: z.string(),
    name: z.string(),
  }),
});

/** `items`, the default key — the legacy `entries` escape hatch is finance-only. */
export const assetListResponse = listResponse(assetListItem);

export type AssetLifecycleStatus = z.infer<typeof assetLifecycleStatus>;
export type AssetListItem = z.infer<typeof assetListItem>;
export type AssetListResponse = z.infer<typeof assetListResponse>;
