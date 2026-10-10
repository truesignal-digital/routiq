import { useQuery } from "@tanstack/react-query";
import type { FinanceOverviewResponse, OverviewRange } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { useBranchScopedParams, type BranchScopedParams } from "../shell/branch-scope.js";

export async function fetchMoneyOverview(
  token: string,
  range: OverviewRange,
  branchId: string | undefined,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FinanceOverviewResponse> {
  const params = new URLSearchParams({ range });
  if (branchId !== undefined) params.set("branchId", branchId);
  const response = await fetchImpl(`/v1/finance/overview?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`FINANCE_OVERVIEW_${response.status}`);
  const body: unknown = await response.json();
  if (!isMoneyOverview(body)) throw new Error("FINANCE_OVERVIEW_SHAPE");
  return body;
}

function isWindow(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const window = value as Record<string, unknown>;
  return (
    typeof window["from"] === "string" &&
    typeof window["to"] === "string" &&
    typeof window["revenueMinor"] === "number" &&
    typeof window["expenseMinor"] === "number"
  );
}

/** Structural, like every read here: the server's schema already holds the details. */
export function isMoneyOverview(value: unknown): value is FinanceOverviewResponse {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Partial<Record<keyof FinanceOverviewResponse, unknown>>;
  return (
    typeof body.currency === "string" &&
    typeof body.range === "string" &&
    (body.view === "PROFIT" || body.view === "REVENUE_AND_EXPENSES") &&
    isWindow(body.period) &&
    isWindow(body.comparison) &&
    Array.isArray(body.expensesByCategory) &&
    typeof body.counted === "object" &&
    body.counted !== null &&
    typeof body.notCounted === "object" &&
    body.notCounted !== null
  );
}

/**
 * The Money Overview's figures for one range (`GET /v1/finance/overview`,
 * #660). Branch-scoped like the entries list, and under the `finance` key so
 * every decision refreshes it.
 */
export function useMoneyOverview(range: OverviewRange, enabled = true) {
  const session = useActiveSession();
  const { branchId } = useBranchScopedParams<BranchScopedParams>({});

  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "finance", "overview", range, branchId ?? "ALL"],
    enabled: enabled && session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchMoneyOverview(token, range, branchId, signal);
    },
  });
}
