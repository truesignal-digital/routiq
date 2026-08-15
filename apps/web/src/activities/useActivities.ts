import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ActivityDetail, ActivityListResponse } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { useBranchScopedParams } from "../shell/branch-scope.js";

export async function fetchActivities(
  token: string,
  params: {
    status?: string;
    completeness?: string;
    branchId?: string;
    assetId?: string;
    activityTypeCode?: string;
    from?: string;
    to?: string;
    sort?: string;
    cursor?: string;
  } = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityListResponse> {
  const url = new URL("/v1/activities", window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    const normalizedValue =
      key === "from" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00.000Z`
        : key === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? `${value}T23:59:59.999Z`
          : value;
    url.searchParams.append(key, normalizedValue);
  }

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`ACTIVITIES_${response.status}`);
  return (await response.json()) as ActivityListResponse;
}

export interface UseActivitiesParams {
  status?: string;
  completeness?: string;
  branchId?: string;
  assetId?: string;
  activityTypeCode?: string;
  from?: string;
  to?: string;
  /** `field:asc|desc`; the cursor is keyed on it, so a change starts a new query. */
  sort?: string;
}

/** Branch-scoped: the shell's current agency narrows it (`branch-scope.ts`). */
export function useActivities(callerParams: UseActivitiesParams = {}) {
  const session = useActiveSession();
  const params = useBranchScopedParams(callerParams);

  return useInfiniteQuery<ActivityListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "activities", params],
    enabled: session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ActivityListResponse) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchActivities(token, { ...params, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}

export async function fetchActivity(
  token: string,
  activityId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityDetail> {
  const response = await fetchImpl(`/v1/activities/${activityId}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`ACTIVITY_${response.status}`);
  return (await response.json()) as ActivityDetail;
}

export function useActivity(activityId: string) {
  const session = useActiveSession();

  return useQuery<ActivityDetail>({
    queryKey: ["ws", session?.workspaceSlug, "activities", "detail", activityId],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchActivity(token, activityId, signal);
    },
  });
}
