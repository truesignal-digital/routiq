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

export function assetDisplayName(asset: AssetListItem): string {
  const makeAndModel = [asset.manufacturer, asset.model].filter(Boolean).join(" ");
  return makeAndModel || asset.assetCode;
}

export function assetMatches(
  asset: AssetListItem,
  query: string,
  filter: AssetFilter,
): boolean {
  const matchesFilter =
    filter === "ALL" ||
    (filter === "IN_SERVICE" && asset.lifecycleStatus === "IN_SERVICE") ||
    (filter === "ATTENTION" &&
      ["UNDER_MAINTENANCE", "RETIRED", "WRITTEN_OFF"].includes(
        asset.lifecycleStatus,
      ));

  if (!matchesFilter) return false;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return [
    asset.assetCode,
    asset.registrationNumber,
    asset.manufacturer,
    asset.model,
    asset.category.labelFr,
    asset.category.labelEn,
    asset.branch.code,
    asset.branch.name,
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

export function summarizeAssets(assets: AssetListItem[]) {
  return {
    total: assets.length,
    inService: assets.filter((asset) => asset.lifecycleStatus === "IN_SERVICE")
      .length,
    attention: assets.filter((asset) =>
      ["UNDER_MAINTENANCE", "RETIRED", "WRITTEN_OFF"].includes(
        asset.lifecycleStatus,
      ),
    ).length,
  };
}
