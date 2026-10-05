import {
  assetLifecycleStatuses,
  type AssetLifecycleStatus,
  type AssetListItem,
  type AssetListResponse,
  type AssetSummary,
} from "@routiq/contracts";

export interface AssetListParams {
  status?: readonly AssetLifecycleStatus[];
  /** The Attention tile's set; the server decides what it covers. */
  attention?: true;
  category?: string;
  branchId?: string;
  search?: string;
  /** `field:asc|desc` over the read's declared sortFields; the cursor is keyed on it. */
  sort?: string;
  cursor?: string;
  limit?: number;
}

/** The list filters the summary shares. A status would count inside one bucket. */
export type AssetSummaryParams = Omit<
  AssetListParams,
  "status" | "attention" | "sort" | "cursor" | "limit"
>;

export type { AssetListResponse, AssetSummary };

function assetQuery(params: AssetListParams): string {
  const query = new URLSearchParams();
  for (const status of params.status ?? []) query.append("status", status);
  if (params.attention) query.append("attention", "true");
  if (params.category) query.append("category", params.category);
  if (params.branchId) query.append("branchId", params.branchId);
  if (params.search) query.append("search", params.search);
  if (params.sort) query.append("sort", params.sort);
  if (params.cursor) query.append("cursor", params.cursor);
  if (params.limit !== undefined) query.append("limit", String(params.limit));
  const search = query.toString();
  return search === "" ? "" : `?${search}`;
}

async function readJson(
  path: string,
  token: string,
  errorPrefix: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(path, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) throw new Error(`${errorPrefix}_${response.status}`);
  return response.json();
}

export async function fetchAssets(
  token: string,
  params: AssetListParams = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AssetListResponse> {
  const body = await readJson(
    `/v1/assets${assetQuery(params)}`,
    token,
    "ASSET_LIST",
    signal,
    fetchImpl,
  );

  if (!isAssetListResponse(body)) throw new Error("ASSET_LIST_INVALID_RESPONSE");
  return body;
}

export async function fetchAssetSummary(
  token: string,
  params: AssetSummaryParams = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AssetSummary> {
  const body = await readJson(
    `/v1/assets/summary${assetQuery(params)}`,
    token,
    "ASSET_SUMMARY",
    signal,
    fetchImpl,
  );

  if (!isAssetSummary(body)) throw new Error("ASSET_SUMMARY_INVALID_RESPONSE");
  return body;
}

/**
 * Structural checks over the contract's own types: enough to catch a superseded
 * envelope or a dropped field, without re-policing formats the server owns.
 */
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

/** A missing bucket must never read as zero — a zero is a claim about the fleet. */
function isAssetSummary(value: unknown): value is AssetSummary {
  return (
    isRecord(value) &&
    isCount(value["total"]) &&
    isCount(value["inService"]) &&
    isCount(value["attention"])
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isLifecycleStatus(value: unknown): value is AssetLifecycleStatus {
  return (
    typeof value === "string" &&
    assetLifecycleStatuses.some((status) => status === value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
