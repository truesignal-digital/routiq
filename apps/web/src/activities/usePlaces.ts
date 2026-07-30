import { useQuery } from "@tanstack/react-query";
import type { PlaceListItem } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";

export interface PlaceListResponse {
  items: PlaceListItem[];
}

export async function fetchPlaces(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceListResponse> {
  const response = await fetchImpl("/v1/places", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`PLACES_${response.status}`);
  return (await response.json()) as PlaceListResponse;
}

/**
 * The workspace's known stops. §3.1 keeps places minimal so route
 * profitability does not degrade to string matching; the list is small enough
 * to suggest from memory.
 */
export function usePlaces() {
  const session = useActiveSession();

  return useQuery<PlaceListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "places"],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchPlaces(token, signal);
    },
  });
}
