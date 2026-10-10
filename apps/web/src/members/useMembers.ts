import { useInfiniteQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { fetchMembers, type MemberListParams, type MemberListResponse } from "./api.js";

export type UseMembersParams = Omit<MemberListParams, "cursor">;

/**
 * The workspace's members, keyset-paged like every other list read (ADR-0003).
 * A pilot workspace fits in one page, but the cursor is what the read offers
 * and a screen that ignored it would quietly stop at fifty people.
 */
export function useMembers(
  params: UseMembersParams = {},
  { enabled = true }: { enabled?: boolean } = {},
) {
  const session = useActiveSession();

  return useInfiniteQuery<MemberListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "members", params],
    enabled: enabled && session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: MemberListResponse) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchMembers(token, { ...params, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}
