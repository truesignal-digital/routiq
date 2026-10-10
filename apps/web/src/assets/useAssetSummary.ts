import { queryOptions, useQuery } from "@tanstack/react-query";
import { useActiveSession } from "../auth/store.js";
import { authed } from "../lib/list-query.js";
import { useBranchScopedParams } from "../shell/branch-scope.js";
import { fetchAssetSummary, type AssetSummaryParams } from "./api.js";

/**
 * Fleet counts from `/v1/assets/summary`. The strip asks the server rather than
 * counting loaded rows: a keyset page knows only what it holds, so counting it
 * would report the page as if it were the fleet. Branch-scoped like the list it
 * sits above, so the tiles count inside the same narrowing.
 */
export function useAssetSummary(callerParams: AssetSummaryParams = {}) {
  const session = useActiveSession();
  return useQuery(assetSummaryQueryOptions(session?.workspaceSlug, useBranchScopedParams(callerParams)));
}

export function assetSummaryQueryOptions(workspaceSlug: string | undefined, params: AssetSummaryParams) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "assets", "summary", params],
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchAssetSummary(token, params, signal)),
  });
}
