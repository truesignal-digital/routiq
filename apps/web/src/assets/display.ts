import type { AssetLifecycleStatus, AssetListItem } from "@routiq/contracts";
import type { AssetListParams } from "./api.js";

/** The status filter's three choices; `ALL` narrows nothing. */
export type AssetFilter = "ALL" | "IN_SERVICE" | "ATTENTION";

export function assetDisplayName(
  asset: Pick<AssetListItem, "assetCode" | "manufacturer" | "model">,
): string {
  const makeAndModel = [asset.manufacturer, asset.model].filter(Boolean).join(" ");
  return makeAndModel || asset.assetCode;
}

/**
 * What a filter choice asks the server for. ATTENTION is the Attention tile's
 * own set (grounded vehicles while MAINTENANCE is on, plus the attention
 * lifecycle statuses), resolved by the server, so the tile and the filtered
 * list can never disagree.
 */
export function assetFilterQuery(
  filter: AssetFilter,
): Pick<AssetListParams, "status" | "attention"> {
  if (filter === "IN_SERVICE") return { status: ["IN_SERVICE"] };
  if (filter === "ATTENTION") return { attention: true };
  return {};
}

export function isAssetFilter(value: string): value is AssetFilter {
  return value === "ALL" || value === "IN_SERVICE" || value === "ATTENTION";
}
