import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";

export interface AssetRegistrationReference {
  assetClasses: Array<{ code: string; labelFr: string; labelEn: string }>;
  branches: Array<{ code: string; name: string }>;
}

export async function fetchAssetRegistrationReference(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AssetRegistrationReference> {
  const response = await fetchImpl("/v1/reference/asset-registration", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`REFERENCE_${response.status}`);
  return (await response.json()) as AssetRegistrationReference;
}

export function useAssetRegistrationReference() {
  const session = useActiveSession();
  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "reference", "asset-registration"],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchAssetRegistrationReference(token, signal);
    },
  });
}
