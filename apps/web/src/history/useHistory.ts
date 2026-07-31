import { useInfiniteQuery } from "@tanstack/react-query";
import type { HistoryEntityType, HistoryListResponse } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";

export async function fetchHistory(
  token: string,
  entityType: HistoryEntityType,
  entityId: string,
  cursor?: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoryListResponse> {
  const url = new URL(
    `/v1/history/${entityType}/${entityId}`,
    window.location.origin,
  );
  if (cursor !== undefined && cursor !== "") {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`HISTORY_${response.status}`);
  return (await response.json()) as HistoryListResponse;
}

/**
 * The timeline costs nothing until someone asks for it: `enabled` is the sheet's
 * open state, so a detail screen on 2G never pays for a fetch nobody opened.
 */
export function useHistory(
  entityType: HistoryEntityType,
  entityId: string,
  { enabled }: { enabled: boolean },
) {
  const session = useActiveSession();

  return useInfiniteQuery<HistoryListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "history", entityType, entityId],
    enabled: enabled && session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: HistoryListResponse) =>
      lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchHistory(
        token,
        entityType,
        entityId,
        pageParam as string | undefined,
        signal,
      );
    },
  });
}
