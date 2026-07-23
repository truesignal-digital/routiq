import {
  ASSET_LIFECYCLE_STATUSES,
  type AssetListItem,
  type AssetLifecycleStatus,
} from "./model.js";

interface AssetListResponse {
  workspaceId: string;
  assets: AssetListItem[];
}

export async function fetchAssets(
  token: string,
  signal?: AbortSignal,
): Promise<AssetListResponse> {
  const response = await fetch("/v1/assets", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) throw new Error(`ASSET_LIST_${response.status}`);
  const body: unknown = await response.json();
  if (!isAssetListResponse(body)) throw new Error("ASSET_LIST_INVALID_RESPONSE");
  return body;
}

function isAssetListResponse(value: unknown): value is AssetListResponse {
  if (!isRecord(value) || typeof value["workspaceId"] !== "string") return false;
  const assets = value["assets"];
  return Array.isArray(assets) && assets.every(isAssetListItem);
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

/**
 * Temporary compatibility seam with ticket 02's keyed session store.
 * Keeping storage parsing here lets the screen work before and after that
 * branch merges, without coupling asset reads to auth implementation details.
 */
export function readActiveSessionToken(storage: Storage): string | null {
  try {
    const raw = storage.getItem("asset.sessions.v1");
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["activeUsername"] !== "string") {
      return null;
    }
    const sessions = parsed["sessions"];
    if (!isRecord(sessions)) return null;
    const active = sessions[parsed["activeUsername"]];
    if (!isRecord(active) || typeof active["token"] !== "string") return null;
    return active["token"];
  } catch {
    return null;
  }
}
