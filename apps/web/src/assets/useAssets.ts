import { useInfiniteQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { fetchAssets, type AssetListResponse } from "./api.js";
import type { AssetLifecycleStatus } from "./model.js";

export interface UseAssetsParams {
  status?: readonly AssetLifecycleStatus[];
  category?: string;
  branchId?: string;
  search?: string;
}

export function useAssets(params: UseAssetsParams = {}) {
  const session = useActiveSession();

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
