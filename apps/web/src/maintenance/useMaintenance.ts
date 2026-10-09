import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  IssueListResponse,
  IssueStatus,
  MaintenanceSummary,
  WorkOrderDetail,
  WorkOrderListResponse,
  WorkOrderStatus,
} from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { useBranchScopedParams } from "../shell/branch-scope.js";

/** Every maintenance read hangs off one key prefix, so one write invalidates all of them. */
export function maintenanceQueryKey(workspaceSlug: string | undefined): unknown[] {
  return ["ws", workspaceSlug, "maintenance"];
}

function buildUrl(path: string, params: object): string {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.append(key, String(value));
  }
  return url.pathname + url.search;
}

export interface UseWorkOrdersParams {
  status?: WorkOrderStatus;
  branchId?: string;
  assetId?: string;
}

export async function fetchWorkOrders(
  token: string,
  params: UseWorkOrdersParams & { cursor?: string } = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkOrderListResponse> {
  const response = await fetchImpl(buildUrl("/v1/work-orders", params), {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`WORK_ORDERS_${response.status}`);
  return (await response.json()) as WorkOrderListResponse;
}

/** Branch-scoped: the shell's current agency narrows it (`branch-scope.ts`). */
export function useWorkOrders(callerParams: UseWorkOrdersParams = {}) {
  const session = useActiveSession();
  const params = useBranchScopedParams(callerParams);

  return useInfiniteQuery<WorkOrderListResponse>({
    queryKey: [...maintenanceQueryKey(session?.workspaceSlug), "work-orders", params],
    enabled: session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: WorkOrderListResponse) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchWorkOrders(token, { ...params, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}

export async function fetchWorkOrder(
  token: string,
  workOrderId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkOrderDetail> {
  const response = await fetchImpl(`/v1/work-orders/${workOrderId}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`WORK_ORDER_${response.status}`);
  return (await response.json()) as WorkOrderDetail;
}

/**
 * The chronologie and cost lines behind one row. Fetched when the sheet opens
 * rather than with the list: a queue of fifty work orders would otherwise carry
 * fifty timelines nobody asked for.
 */
export function useWorkOrder(workOrderId: string | undefined) {
  const session = useActiveSession();

  return useQuery<WorkOrderDetail>({
    queryKey: [
      ...maintenanceQueryKey(session?.workspaceSlug),
      "work-orders",
      "detail",
      workOrderId,
    ],
    enabled: session !== undefined && workOrderId !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      if (workOrderId === undefined) throw new Error("REFERENCE_NOT_FOUND");
      return fetchWorkOrder(token, workOrderId, signal);
    },
  });
}

export interface UseIssuesParams {
  branchId?: string;
  assetId?: string;
  safetyCritical?: boolean;
  status?: IssueStatus;
}

export async function fetchIssues(
  token: string,
  params: {
    branchId?: string;
    assetId?: string;
    safetyCritical?: string;
    status?: IssueStatus;
    cursor?: string;
  } = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<IssueListResponse> {
  const response = await fetchImpl(buildUrl("/v1/issues", params), {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`ISSUES_${response.status}`);
  return (await response.json()) as IssueListResponse;
}

/** Branch-scoped, like the work-order queue: both resolve branch through the asset. */
export function useIssues(callerParams: UseIssuesParams = {}) {
  const session = useActiveSession();
  const { safetyCritical, ...rest } = callerParams;
  const params = useBranchScopedParams({
    ...rest,
    ...(safetyCritical === undefined ? {} : { safetyCritical: String(safetyCritical) }),
  });

  return useInfiniteQuery<IssueListResponse>({
    queryKey: [...maintenanceQueryKey(session?.workspaceSlug), "issues", params],
    enabled: session !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: IssueListResponse) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const cursor = pageParam as string | undefined;
      return fetchIssues(token, { ...params, ...(cursor ? { cursor } : {}) }, signal);
    },
  });
}

function isMaintenanceSummary(value: unknown): value is MaintenanceSummary {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const average = record["averageRepairDays"];
  return (
    ["openIssues", "openSafetyCritical", "grounded", "approvedWorkOrders", "repairsCounted", "repairWindowDays"].every(
      (key) => typeof record[key] === "number",
    ) &&
    (average === null || typeof average === "number")
  );
}

export async function fetchMaintenanceSummary(
  token: string,
  params: { branchId?: string } = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<MaintenanceSummary> {
  const response = await fetchImpl(buildUrl("/v1/maintenance/summary", params), {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`MAINTENANCE_SUMMARY_${response.status}`);
  const body: unknown = await response.json();
  if (!isMaintenanceSummary(body)) throw new Error("MAINTENANCE_SUMMARY_INVALID_RESPONSE");
  return body;
}

/**
 * The workshop's overview counts, from the server: a keyset page knows only
 * what it holds. Under the maintenance key, so every maintenance write that
 * refreshes the lists refreshes the tiles too.
 */
export function useMaintenanceSummary() {
  const session = useActiveSession();
  const params = useBranchScopedParams({});

  return useQuery<MaintenanceSummary>({
    queryKey: [...maintenanceQueryKey(session?.workspaceSlug), "summary", params],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchMaintenanceSummary(token, params, signal);
    },
  });
}
