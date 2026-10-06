import { queryOptions, useQuery } from "@tanstack/react-query";
import type { FinanceSummaryResponse } from "@routiq/contracts";
import { useActiveSession } from "../auth/store.js";
import { authed } from "../lib/list-query.js";
import { useBranchScopedParams, type BranchScopedParams } from "../shell/branch-scope.js";

export async function fetchFinanceSummary(
  token: string,
  branchId: string | undefined,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FinanceSummaryResponse> {
  const url = new URL("/v1/finance/summary", window.location.origin);
  if (branchId !== undefined) url.searchParams.set("branchId", branchId);
  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`FINANCE_SUMMARY_${response.status}`);
  const body: unknown = await response.json();
  if (!isFinanceSummary(body)) throw new Error("FINANCE_SUMMARY_SHAPE");
  return body;
}

export function isFinanceSummary(value: unknown): value is FinanceSummaryResponse {
  if (typeof value !== "object" || value === null) return false;
  const summary = value as Partial<Record<keyof FinanceSummaryResponse, unknown>>;
  return (
    typeof summary.currency === "string" &&
    typeof summary.month === "string" &&
    typeof summary.outMinor === "number" &&
    typeof summary.inMinor === "number" &&
    typeof summary.missingReceipt === "object" &&
    summary.missingReceipt !== null &&
    (summary.waiting === null || typeof summary.waiting === "object")
  );
}

/**
 * The Money page's tiles and lead line. Branch-scoped like the entries list it
 * sits on, and under the `finance` key so every decision refreshes it.
 */
export function useFinanceSummary(enabled = true) {
  const session = useActiveSession();
  const { branchId } = useBranchScopedParams<BranchScopedParams>({});
  return useQuery({ ...financeSummaryQueryOptions(session?.workspaceSlug, branchId), enabled: enabled && session !== undefined });
}

/** `branchId` is the shell's: `useBranchScopedParams` in a hook, `scopedParams` in a loader. */
export function financeSummaryQueryOptions(workspaceSlug: string | undefined, branchId: string | undefined) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "finance", "summary", branchId ?? "ALL"],
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchFinanceSummary(token, branchId, signal)),
  });
}
