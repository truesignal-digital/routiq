import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import type { FinancialEntryDetail } from "@routiq/contracts";

export async function fetchFinanceEntry(
  entryId: string,
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FinancialEntryDetail> {
  const response = await fetchImpl(`/v1/finance/entries/${encodeURIComponent(entryId)}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`ENTRY_${response.status}`);
  return (await response.json()) as FinancialEntryDetail;
}

export function useEntry(entryId: string | undefined) {
  const session = useActiveSession();
  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "finance", "entry", entryId],
    enabled: session !== undefined && entryId !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      if (entryId === undefined) throw new Error("ENTRY_ID_REQUIRED");
      return fetchFinanceEntry(entryId, token, signal);
    },
  });
}
