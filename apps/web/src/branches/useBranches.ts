import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { fetchBranches, type BranchListParams, type BranchListResponse } from "./api.js";

export type UseBranchesParams = Omit<BranchListParams, "cursor">;

/**
 * The workspace's branches, keyset-paged like every other list read (ADR-0003).
 * A workspace has a handful of them, but the cursor is what the read offers and
 * a screen that ignored it would quietly stop at fifty.
 */
export function useBranches(params: UseBranchesParams = {}) {
  const session = useActiveSession();

  return useInfiniteQuery<BranchListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "branches", params],
    enabled: session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: BranchListResponse) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchBranches(token, { ...params, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}

/**
 * What every branch command invalidates. The reference read is in the list on
 * purpose: it is where the member scope picker and the branch fields on the
 * record forms get their branches, so a branch created here has to reach them
 * without a page reload.
 */
export function useInvalidateBranches() {
  const queryClient = useQueryClient();
  const session = useActiveSession();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["ws", session?.workspaceSlug, "branches"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["ws", session?.workspaceSlug, "reference"],
      }),
    ]);
  };
}
