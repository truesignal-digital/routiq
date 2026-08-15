import { useQuery } from "@tanstack/react-query";
import {
  DASHBOARD_SERIES_DAYS_DEFAULT,
  dashboardResponse,
  type DashboardResponse,
} from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import {
  useBranchScopedParams,
  type BranchScopedParams,
} from "../shell/branch-scope.js";

export async function fetchDashboard(
  token: string,
  days: number,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  branchId?: string,
): Promise<DashboardResponse> {
  const url = new URL("/v1/dashboard", window.location.origin);
  url.searchParams.set("days", String(days));
  // Narrows inside the caller's branch scope; it can never widen it (ADR-0003).
  if (branchId !== undefined) url.searchParams.set("branchId", branchId);

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`DASHBOARD_${response.status}`);
  // Parsed rather than cast: the home screen counts nothing itself, so a shape
  // that drifted from the contract has to fail loudly instead of rendering a
  // KPI as blank.
  return dashboardResponse.parse(await response.json());
}

/**
 * `days` and the ambient branch are part of the key: each is its own window.
 * Branch-scoped: the shell's current agency narrows it (`branch-scope.ts`).
 */
export function useDashboard(days: number = DASHBOARD_SERIES_DAYS_DEFAULT) {
  const session = useActiveSession();
  const { branchId } = useBranchScopedParams<BranchScopedParams>({});

  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "dashboard", days, branchId ?? "ALL"],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchDashboard(token, days, signal, fetch, branchId);
    },
  });
}
