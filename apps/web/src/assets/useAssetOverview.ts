import { useQuery } from "@tanstack/react-query";
import type { AssetOverview } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { useBranchScopedParams, type BranchScopedParams } from "../shell/branch-scope.js";
import { fetchAssetOverview } from "./api.js";

/**
 * Can the fleet work? (`/v1/assets/overview`, #665). Branch-scoped like the
 * list its tiles open, and under the assets key so a fleet write refreshes it.
 */
export function useAssetOverview() {
  const session = useActiveSession();
  const params = useBranchScopedParams<BranchScopedParams>({});

  return useQuery<AssetOverview>({
    queryKey: ["ws", session?.workspaceSlug, "assets", "overview", params],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchAssetOverview(token, params, signal);
    },
  });
}
