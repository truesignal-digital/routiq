import { useInfiniteQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { useBranchScopedParams } from "../shell/branch-scope.js";
import type { FinancialEntryListResponse } from "@routiq/contracts";

export async function fetchFinanceEntries(
  token: string,
  params?: {
    status?: string;
    direction?: string;
    periodCode?: string;
    economicMonth?: string;
    evidence?: string;
    assetId?: string;
    branchId?: string;
    view?: string;
    sort?: string;
    cursor?: string;
  },
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FinancialEntryListResponse> {
  const url = new URL("/v1/finance/entries", window.location.origin);
  if (params?.status) url.searchParams.append("status", params.status);
  if (params?.direction) url.searchParams.append("direction", params.direction);
  if (params?.periodCode) url.searchParams.append("periodCode", params.periodCode);
  if (params?.economicMonth) url.searchParams.append("economicMonth", params.economicMonth);
  if (params?.evidence) url.searchParams.append("evidence", params.evidence);
  if (params?.assetId) url.searchParams.append("assetId", params.assetId);
  if (params?.branchId) url.searchParams.append("branchId", params.branchId);
  if (params?.view) url.searchParams.append("view", params.view);
  if (params?.sort) url.searchParams.append("sort", params.sort);
  if (params?.cursor) url.searchParams.append("cursor", params.cursor);

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`ENTRIES_${response.status}`);
  return (await response.json()) as FinancialEntryListResponse;
}

export interface UseEntriesParams {
  status?: string;
  direction?: string;
  periodCode?: string;
  /** `YYYY-MM` of the economic date: the Money page's month tiles. */
  economicMonth?: string;
  /** `MISSING`: entries still waiting for paperwork. */
  evidence?: string;
  assetId?: string;
  branchId?: string;
  /** `books` lists every signed row; the default is one line per event (#427). */
  view?: "events" | "books";
  /** `field:asc|desc`; the cursor is keyed on it, so a change starts a new query. */
  sort?: string;
}

/** Branch-scoped: the shell's current agency narrows it (`branch-scope.ts`). */
export function useEntries(params: UseEntriesParams = {}) {
  const session = useActiveSession();
  const query = useBranchScopedParams(params);

  return useInfiniteQuery<FinancialEntryListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "finance", "entries", query],
    enabled: session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: FinancialEntryListResponse) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchFinanceEntries(token, { ...query, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}
