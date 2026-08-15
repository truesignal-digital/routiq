import { useQuery } from "@tanstack/react-query";
import type { AssetSummary } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
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
  const params = useBranchScopedParams(callerParams);

  return useQuery<AssetSummary>({
    queryKey: ["ws", session?.workspaceSlug, "assets", "summary", params],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchAssetSummary(token, params, signal);
    },
  });
}
