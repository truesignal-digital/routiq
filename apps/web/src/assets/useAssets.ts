import { useInfiniteQuery } from "@tanstack/react-query";
import type { AssetListResponse } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { useBranchScopedParams } from "../shell/branch-scope.js";
import { fetchAssets, type AssetListParams } from "./api.js";

export type UseAssetsParams = Omit<AssetListParams, "cursor">;

/** Branch-scoped: the shell's current agency narrows it (`branch-scope.ts`). */
export function useAssets(callerParams: UseAssetsParams = {}) {
  const session = useActiveSession();
  const params = useBranchScopedParams(callerParams);

  return useInfiniteQuery<AssetListResponse>({
    // Workspace-scoped key: the cache can never leak across a workspace switch.
    queryKey: ["ws", session?.workspaceSlug, "assets", params],
    enabled: session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AssetListResponse) =>
      lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchAssets(token, { ...params, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}
