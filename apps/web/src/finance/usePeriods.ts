import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import type { PeriodsResponse } from "@routiq/contracts";

export async function fetchPeriods(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PeriodsResponse> {
  const response = await fetchImpl("/v1/finance/periods", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`PERIODS_${response.status}`);
  return (await response.json()) as PeriodsResponse;
}

export function usePeriods(enabled = true) {
  const session = useActiveSession();
  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "finance", "periods"],
    enabled: enabled && session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchPeriods(token, signal);
    },
  });
}
