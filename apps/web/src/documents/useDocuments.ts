import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import type { AssetDocumentsReadResponse } from "@routiq/contracts";

export async function fetchAssetDocuments(
  assetId: string,
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AssetDocumentsReadResponse> {
  const response = await fetchImpl(`/v1/assets/${assetId}/documents`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`DOCUMENTS_${response.status}`);
  return (await response.json()) as AssetDocumentsReadResponse;
}

export function useAssetDocuments(assetId: string) {
  const session = useActiveSession();
  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "asset", assetId, "documents"],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchAssetDocuments(assetId, token, signal);
    },
  });
}
