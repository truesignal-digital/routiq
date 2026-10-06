import { infiniteQueryOptions, type QueryKey } from "@tanstack/react-query";
import { sessionStore } from "../auth/store.js";

/**
 * A keyset-paged list read, shared by the screen's hook and the route's loader
 * (#496), so both name the same cache entry. `params` is part of the key and
 * of every page request; the cursor is added per page.
 */
export function listQueryOptions<TPage extends { nextCursor?: string | null }, TParams extends object>(
  queryKey: QueryKey,
  workspaceSlug: string | undefined,
  params: TParams,
  fetchPage: (token: string, params: TParams & { cursor?: string }, signal?: AbortSignal) => Promise<TPage>,
) {
  return infiniteQueryOptions({
    queryKey,
    enabled: workspaceSlug !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: TPage) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchPage(token, { ...params, ...(pageParam ? { cursor: pageParam } : {}) }, signal);
    },
  });
}

/** A read with no pages, keyed and fetched the same way from the hook and the loader. */
export function authed<T>(fetchWith: (token: string, signal?: AbortSignal) => Promise<T>) {
  return ({ signal }: { signal?: AbortSignal }) => {
    const token = sessionStore.getToken();
    if (token === undefined) throw new Error("AUTH_REQUIRED");
    return fetchWith(token, signal);
  };
}
