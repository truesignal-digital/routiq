import { useInfiniteQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import type { PendingApprovalsResponse } from "@routiq/contracts";

export async function fetchApprovals(
  token: string,
  params?: { branchId?: string; sort?: string; cursor?: string },
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PendingApprovalsResponse> {
  const url = new URL("/v1/finance/approvals", window.location.origin);
  if (params?.branchId) url.searchParams.append("branchId", params.branchId);
  if (params?.sort) url.searchParams.append("sort", params.sort);
  if (params?.cursor) url.searchParams.append("cursor", params.cursor);

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`APPROVALS_${response.status}`);
  return (await response.json()) as PendingApprovalsResponse;
}

export interface UseApprovalsParams {
  /** The queue's own visible filter. Absent means every branch in scope. */
  branchId?: string;
  /** `field:asc|desc`; the cursor is keyed on it, so a change starts a new query. */
  sort?: string;
}

/**
 * The pending queue, keyset-paginated. Every page carries the queue's `total`,
 * so a caller that only wants the badge count can read it off the first page
 * without draining the cursor.
 *
 * Deliberately *not* a branch-scoped read (`branch-scope.ts`): a decision queue
 * that silently followed the shell would leave work pending in a branch nobody
 * is looking at. The screen presets its own visible filter from the ambient
 * branch instead, and the operator can widen it back to every branch.
 */
export function useApprovals(enabled = true, params: UseApprovalsParams = {}) {
  const session = useActiveSession();

  return useInfiniteQuery<PendingApprovalsResponse>({
    queryKey: ["ws", session?.workspaceSlug, "finance", "approvals", params],
    enabled: enabled && session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchApprovals(token, { ...params, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}

/** The whole queue's size, which every page reports. */
export function approvalsTotal(
  data: { pages: PendingApprovalsResponse[] } | undefined,
): number {
  return data?.pages[0]?.total ?? 0;
}

/**
 * Pending work the queue's own branch filter is leaving out, inside the
 * caller's scope. Zero without a filter — and the only trace on screen that a
 * narrowed queue is not the whole queue.
 */
export function approvalsOutsideBranch(
  data: { pages: PendingApprovalsResponse[] } | undefined,
): number {
  return data?.pages[0]?.outsideBranchCount ?? 0;
}
