import { queryOptions, useQuery } from "@tanstack/react-query";
import type { AssetOverview } from "@routiq/contracts";
import { useActiveSession } from "../auth/store.js";
import { authed } from "../lib/list-query.js";
import { useBranchScopedParams, type BranchScopedParams } from "../shell/branch-scope.js";
import { fetchAssetOverview } from "./api.js";

/**
 * Can the fleet work? (`/v1/assets/overview`, #665). Branch-scoped like the
 * list its tiles open, and under the assets key so a fleet write refreshes it.
 */
export function useAssetOverview() {
  const session = useActiveSession();
  return useQuery(assetOverviewQueryOptions(session?.workspaceSlug, useBranchScopedParams<BranchScopedParams>({})));
}

/** `params` already carries the branch: `useBranchScopedParams` in a hook, `scopedParams` in a loader. */
export function assetOverviewQueryOptions(workspaceSlug: string | undefined, params: BranchScopedParams) {
  return queryOptions<AssetOverview>({
    queryKey: ["ws", workspaceSlug, "assets", "overview", params],
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchAssetOverview(token, params, signal)),
  });
}
