import type { AssetDetail } from "@routiq/contracts";
import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";

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

export function useAssetDetail(assetId: string) {
  const session = useActiveSession();

  return useQuery<AssetDetail>({
    // Shares the `["ws", slug, "asset", id]` prefix with this asset's
    // documents, so a write to either can invalidate the pair.
    queryKey: ["ws", session?.workspaceSlug, "asset", assetId, "detail"],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchAssetDetail(token, assetId, signal);
    },
  });
}
