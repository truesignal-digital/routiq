export const ASSET_LIFECYCLE_STATUSES = [
  "REGISTERED",
  "IN_SERVICE",
  "UNDER_MAINTENANCE",
  "SOLD",
  "RETIRED",
  "WRITTEN_OFF",
] as const;

export type AssetLifecycleStatus = (typeof ASSET_LIFECYCLE_STATUSES)[number];

export interface AssetListItem {
  id: string;
  assetCode: string;
  registrationNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  lifecycleStatus: AssetLifecycleStatus;
  rowVersion: number;
  category: {
    code: string;
    labelFr: string;
    labelEn: string;
  };
  branch: {
    code: string;
    name: string;
  };
}

export type AssetFilter = "ALL" | "IN_SERVICE" | "ATTENTION";

export const ATTENTION_STATUSES = [
  "UNDER_MAINTENANCE",
  "RETIRED",
  "WRITTEN_OFF",
] as const satisfies readonly AssetLifecycleStatus[];

export function assetDisplayName(asset: AssetListItem): string {
  const makeAndModel = [asset.manufacturer, asset.model].filter(Boolean).join(" ");
  return makeAndModel || asset.assetCode;
}

/** The statuses a filter tab asks the server for; `ALL` constrains nothing. */
export function assetFilterStatuses(
  filter: AssetFilter,
): readonly AssetLifecycleStatus[] | undefined {
  if (filter === "IN_SERVICE") return ["IN_SERVICE"];
  if (filter === "ATTENTION") return ATTENTION_STATUSES;
  return undefined;
}

export function summarizeAssets(assets: AssetListItem[]) {
  const attention: readonly string[] = ATTENTION_STATUSES;
  return {
    total: assets.length,
    inService: assets.filter((asset) => asset.lifecycleStatus === "IN_SERVICE")
      .length,
    attention: assets.filter((asset) => attention.includes(asset.lifecycleStatus))
      .length,
  };
}
