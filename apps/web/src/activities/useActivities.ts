import { queryOptions, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  ActivityDetail,
  ActivityListResponse,
  ActivitySummary,
} from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { authed, listQueryOptions } from "../lib/list-query.js";
import { useBranchScopedParams } from "../shell/branch-scope.js";

export async function fetchActivities(
  token: string,
  params: {
    status?: string;
    completeness?: string;
    branchId?: string;
    assetId?: string;
    activityTypeCode?: string;
    /** ISO dates; the server reads them as workspace days (#511). */
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
    url.searchParams.append(key, value);
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
  return useInfiniteQuery(activitiesQueryOptions(session?.workspaceSlug, useBranchScopedParams(callerParams)));
}

/** `params` already carries the branch: `useBranchScopedParams` in a hook, `scopedParams` in a loader. */
export function activitiesQueryOptions(workspaceSlug: string | undefined, params: UseActivitiesParams) {
  return listQueryOptions(["ws", workspaceSlug, "activities", params], workspaceSlug, params, fetchActivities);
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

function isActivitySummary(value: unknown): value is ActivitySummary {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const week = record["week"];
  const km = record["weekKm"];
  return (
    typeof week === "object" &&
    week !== null &&
    typeof (week as Record<string, unknown>)["from"] === "string" &&
    typeof (week as Record<string, unknown>)["to"] === "string" &&
    typeof record["thisWeek"] === "number" &&
    typeof record["open"] === "number" &&
    typeof record["incomplete"] === "number" &&
    (km === null || typeof km === "number")
  );
}

export async function fetchActivitySummary(
  token: string,
  params: { branchId?: string } = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivitySummary> {
  const query = params.branchId === undefined ? "" : `?branchId=${encodeURIComponent(params.branchId)}`;
  const response = await fetchImpl(`/v1/activities/summary${query}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`ACTIVITY_SUMMARY_${response.status}`);
  const body: unknown = await response.json();
  if (!isActivitySummary(body)) throw new Error("ACTIVITY_SUMMARY_INVALID_RESPONSE");
  return body;
}

/**
 * The Trips overview counts, from the server. Under the activities key, so a
 * trip write that refreshes the list refreshes the tiles too.
 */
export function useActivitySummary() {
  const session = useActiveSession();
  return useQuery(activitySummaryQueryOptions(session?.workspaceSlug, useBranchScopedParams({})));
}

/** `params` already carries the branch: `useBranchScopedParams` in a hook, `scopedParams` in a loader. */
export function activitySummaryQueryOptions(workspaceSlug: string | undefined, params: { branchId?: string }) {
  return queryOptions<ActivitySummary>({
    queryKey: ["ws", workspaceSlug, "activities", "summary", params],
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchActivitySummary(token, params, signal)),
  });
}
