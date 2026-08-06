import { useInfiniteQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { useAmbientBranchId } from "../shell/branch-context.js";
import type { FinancialEntryListResponse } from "@routiq/contracts";

export async function fetchFinanceEntries(
  token: string,
  params?: {
    status?: string;
    periodCode?: string;
    assetId?: string;
    branchId?: string;
    sort?: string;
    cursor?: string;
  },
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FinancialEntryListResponse> {
  const url = new URL("/v1/finance/entries", window.location.origin);
  if (params?.status) url.searchParams.append("status", params.status);
  if (params?.periodCode) url.searchParams.append("periodCode", params.periodCode);
  if (params?.assetId) url.searchParams.append("assetId", params.assetId);
  if (params?.branchId) url.searchParams.append("branchId", params.branchId);
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
  periodCode?: string;
  assetId?: string;
  branchId?: string;
  /** `field:asc|desc`; the cursor is keyed on it, so a change starts a new query. */
  sort?: string;
}

export function useEntries(params: UseEntriesParams = {}) {
  const session = useActiveSession();
  // The shell's current agency is the default narrowing; a caller that names a
  // branch itself keeps it.
  const branchId = useAmbientBranchId(params.branchId);
  const query: UseEntriesParams = {
    ...params,
    ...(branchId === undefined ? {} : { branchId }),
  };

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
