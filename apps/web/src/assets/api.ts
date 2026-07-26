import {
  ASSET_LIFECYCLE_STATUSES,
  type AssetLifecycleStatus,
  type AssetListItem,
} from "./model.js";

export interface AssetListParams {
  status?: readonly AssetLifecycleStatus[];
  category?: string;
  branchId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

/** The ADR-0003 list envelope: `items` plus the opaque keyset cursor. */
export interface AssetListResponse {
  items: AssetListItem[];
  nextCursor: string | null;
}

export async function fetchAssets(
  token: string,
  params: AssetListParams = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AssetListResponse> {
  const url = new URL("/v1/assets", window.location.origin);
  for (const status of params.status ?? []) {
    url.searchParams.append("status", status);
  }
  if (params.category) url.searchParams.append("category", params.category);
  if (params.branchId) url.searchParams.append("branchId", params.branchId);
  if (params.search) url.searchParams.append("search", params.search);
  if (params.cursor) url.searchParams.append("cursor", params.cursor);
  if (params.limit !== undefined) {
    url.searchParams.append("limit", String(params.limit));
  }

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) throw new Error(`ASSET_LIST_${response.status}`);
  const body: unknown = await response.json();
  if (!isAssetListResponse(body)) throw new Error("ASSET_LIST_INVALID_RESPONSE");
  return body;
}

function isAssetListResponse(value: unknown): value is AssetListResponse {
  if (!isRecord(value)) return false;
  const nextCursor = value["nextCursor"];
  if (nextCursor !== null && typeof nextCursor !== "string") return false;
  const items = value["items"];
  return Array.isArray(items) && items.every(isAssetListItem);
}

function isAssetListItem(value: unknown): value is AssetListItem {
  if (!isRecord(value)) return false;
  const category = value["category"];
  const branch = value["branch"];
  return (
    typeof value["id"] === "string" &&
    typeof value["assetCode"] === "string" &&
    nullableString(value["registrationNumber"]) &&
    nullableString(value["manufacturer"]) &&
    nullableString(value["model"]) &&
    isLifecycleStatus(value["lifecycleStatus"]) &&
    typeof value["rowVersion"] === "number" &&
    isRecord(category) &&
    typeof category["code"] === "string" &&
    typeof category["labelFr"] === "string" &&
    typeof category["labelEn"] === "string" &&
    isRecord(branch) &&
    typeof branch["code"] === "string" &&
    typeof branch["name"] === "string"
  );
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isLifecycleStatus(value: unknown): value is AssetLifecycleStatus {
  return (
    typeof value === "string" &&
    ASSET_LIFECYCLE_STATUSES.some((status) => status === value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
