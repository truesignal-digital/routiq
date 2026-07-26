import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import type { PendingApprovalsResponse } from "@routiq/contracts";

export async function fetchApprovals(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PendingApprovalsResponse> {
  const response = await fetchImpl("/v1/finance/approvals", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`APPROVALS_${response.status}`);
  return (await response.json()) as PendingApprovalsResponse;
}

export function useApprovals() {
  const session = useActiveSession();
  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "finance", "approvals"],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchApprovals(token, signal);
    },
  });
}
