import {
  assetAttentionStatuses,
  type AssetLifecycleStatus,
  type AssetListItem,
} from "@routiq/contracts";

/** The status filter's three choices; `ALL` narrows nothing. */
export type AssetFilter = "ALL" | "IN_SERVICE" | "ATTENTION";

export function assetDisplayName(
  asset: Pick<AssetListItem, "assetCode" | "manufacturer" | "model">,
): string {
  const makeAndModel = [asset.manufacturer, asset.model].filter(Boolean).join(" ");
  return makeAndModel || asset.assetCode;
}

/**
 * The statuses a filter choice asks the server for. ATTENTION resolves through
 * the contract's own set, the same one `/v1/assets/summary` counts, so the tile
 * and the filtered list can never disagree about what needs attention.
 */
export function assetFilterStatuses(
  filter: AssetFilter,
): readonly AssetLifecycleStatus[] | undefined {
  if (filter === "IN_SERVICE") return ["IN_SERVICE"];
  if (filter === "ATTENTION") return assetAttentionStatuses;
  return undefined;
}

export function isAssetFilter(value: string): value is AssetFilter {
  return value === "ALL" || value === "IN_SERVICE" || value === "ATTENTION";
}
