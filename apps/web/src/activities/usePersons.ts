import { useQuery } from "@tanstack/react-query";
import type { PersonListItem } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";

export interface PersonListResponse {
  items: PersonListItem[];
}

export async function fetchPersons(
  token: string,
  params: { branchId?: string; active?: boolean; search?: string } = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PersonListResponse> {
  const url = new URL("/v1/persons", window.location.origin);
  if (params.branchId) url.searchParams.append("branchId", params.branchId);
  if (params.active !== undefined) {
    url.searchParams.append("active", String(params.active));
  }
  if (params.search) url.searchParams.append("search", params.search);

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`PERSONS_${response.status}`);
  return (await response.json()) as PersonListResponse;
}

export interface UsePersonsParams {
  branchId?: string;
  active?: boolean;
  search?: string;
}

/**
 * The branch's people, one unpaginated list. A pilot branch has tens of
 * drivers, so the picker filters what it already holds rather than round-
 * tripping every keystroke over an intermittent link.
 */
export function usePersons(params: UsePersonsParams = {}) {
  const session = useActiveSession();

  return useQuery<PersonListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "persons", params],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchPersons(token, params, signal);
    },
  });
}
