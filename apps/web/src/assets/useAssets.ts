import { useInfiniteQuery } from "@tanstack/react-query";
import { listQueryOptions } from "../lib/list-query.js";
import { useActiveSession } from "../auth/store.js";
import { useBranchScopedParams } from "../shell/branch-scope.js";
import { fetchAssets, type AssetListParams } from "./api.js";

export type UseAssetsParams = Omit<AssetListParams, "cursor">;

/** Branch-scoped: the shell's current agency narrows it (`branch-scope.ts`). */
export function useAssets(callerParams: UseAssetsParams = {}) {
  const session = useActiveSession();
  return useInfiniteQuery(assetsQueryOptions(session?.workspaceSlug, useBranchScopedParams(callerParams)));
}

/** `params` already carries the branch: `useBranchScopedParams` in a hook, `scopedParams` in a loader. */
export function assetsQueryOptions(workspaceSlug: string | undefined, params: UseAssetsParams) {
  // Workspace-scoped key: the cache can never leak across a workspace switch.
  return listQueryOptions(["ws", workspaceSlug, "assets", params], workspaceSlug, params, fetchAssets);
}
