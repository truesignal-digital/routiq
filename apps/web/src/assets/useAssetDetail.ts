import type { AssetDetail } from "@routiq/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useActiveSession } from "../auth/store.js";
import { authed } from "../lib/list-query.js";
import { retryUnlessNotFound } from "../lib/query-retry.js";

export async function fetchAssetDetail(
  token: string,
  assetId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AssetDetail> {
  const response = await fetchImpl(`/v1/assets/${assetId}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`ASSET_DETAIL_${response.status}`);
  return (await response.json()) as AssetDetail;
}

/** Shares the `["ws", slug, "asset", id]` prefix with this asset's other reads. */
export function assetDetailQueryKey(workspaceSlug: string | undefined, assetId: string): unknown[] {
  return ["ws", workspaceSlug, "asset", assetId, "detail"];
}

export function useAssetDetail(assetId: string) {
  const session = useActiveSession();
  return useQuery(assetDetailQueryOptions(session?.workspaceSlug, assetId));
}

export function assetDetailQueryOptions(workspaceSlug: string | undefined, assetId: string) {
  return queryOptions<AssetDetail>({
    // Shares the `["ws", slug, "asset", id]` prefix with this asset's
    // documents, so a write to either can invalidate the pair.
    queryKey: assetDetailQueryKey(workspaceSlug, assetId),
    // A vehicle outside the caller's scope is a 404: show that at once. The
    // route loader already made these attempts, so the screen does not
    // repeat them on mount (#496).
    retry: retryUnlessNotFound,
    retryOnMount: false,
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchAssetDetail(token, assetId, signal)),
  });
}
