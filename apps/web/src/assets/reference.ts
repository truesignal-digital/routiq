import { queryOptions, useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { REFERENCE_STALE_MS } from "../lib/query-defaults.js";

export interface AssetRegistrationReference {
  assetClasses: Array<{ code: string; labelFr: string; labelEn: string }>;
  /** `code` names a branch in commands, `id` filters the list reads by one. */
  branches: Array<{ id: string; code: string; name: string }>;
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
  return useQuery(assetRegistrationReferenceQueryOptions(useActiveSession()?.workspaceSlug));
}

/** Also loaded by the shell before it draws: the header's branch switcher lists these branches (#495). */
export function assetRegistrationReferenceQueryOptions(workspaceSlug: string | undefined) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "reference", "asset-registration"] as const,
    enabled: workspaceSlug !== undefined,
    staleTime: REFERENCE_STALE_MS,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchAssetRegistrationReference(token, signal);
    },
  });
}
