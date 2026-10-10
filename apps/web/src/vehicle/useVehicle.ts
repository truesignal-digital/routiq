import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssetAttentionResponse,
  AssetFinanceResponse,
  AssetReadingsResponse,
  CustodianCandidatesResponse,
  FinancialEntryListResponse,
  HistoryEventDiff,
  HistoryListResponse,
  IssueDetail,
  NoteDetail,
  VehicleHistoryKind,
  VehicleHistoryResponse,
  WorkOrderDetail,
} from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { retryUnlessNotFound } from "../lib/query-retry.js";
import { maintenanceQueryKey } from "../maintenance/useMaintenance.js";
import type { PanelRef } from "./model.js";

/**
 * Every read about one vehicle hangs off this prefix — the detail, its
 * documents and the workspace reads below — so a write on the vehicle can
 * refresh all of them at once.
 */
export function vehicleQueryKey(workspaceSlug: string | undefined, assetId: string): unknown[] {
  return ["ws", workspaceSlug, "asset", assetId];
}

async function getJson<T>(path: string, signal: AbortSignal | undefined, failure: string): Promise<T> {
  const token = sessionStore.getToken();
  if (token === undefined) throw new Error("AUTH_REQUIRED");
  const response = await fetch(path, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`${failure}_${response.status}`);
  return (await response.json()) as T;
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.append(key, value);
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

/** What needs someone on this vehicle, as facts the client turns into to-dos. */
export function useAssetAttention(assetId: string, enabled = true) {
  const session = useActiveSession();
  const options = assetAttentionQueryOptions(session?.workspaceSlug, assetId);
  return useQuery({ ...options, enabled: session !== undefined && enabled });
}

export function assetAttentionQueryOptions(workspaceSlug: string | undefined, assetId: string) {
  return queryOptions<AssetAttentionResponse>({
    queryKey: [...vehicleQueryKey(workspaceSlug, assetId), "attention"],
    retry: retryUnlessNotFound,
    // Loaded by the route loader with these attempts; not repeated on mount (#496).
    retryOnMount: false,
    enabled: workspaceSlug !== undefined,
    queryFn: ({ signal }) => getJson(`/v1/assets/${assetId}/attention`, signal, "ATTENTION"),
  });
}

/** One month of this vehicle's money. Only ever enabled for finance readers. */
export function useAssetFinance(assetId: string, periodCode: string | undefined, enabled: boolean) {
  const session = useActiveSession();
  const options = assetFinanceQueryOptions(session?.workspaceSlug, assetId, periodCode);
  return useQuery({ ...options, enabled: session !== undefined && enabled });
}

export function assetFinanceQueryOptions(workspaceSlug: string | undefined, assetId: string, periodCode: string | undefined) {
  return queryOptions<AssetFinanceResponse>({
    queryKey: [...vehicleQueryKey(workspaceSlug, assetId), "finance", periodCode ?? "current"],
    retry: retryUnlessNotFound,
    // Loaded by the route loader with these attempts; not repeated on mount (#496).
    retryOnMount: false,
    enabled: workspaceSlug !== undefined,
    queryFn: ({ signal }) =>
      getJson(withQuery(`/v1/assets/${assetId}/finance`, { periodCode }), signal, "ASSET_FINANCE"),
  });
}

/**
 * The vehicle's timeline over the audit trail, newest first. Money kinds reach
 * only the roles that read the books; the server leaves them out for the rest.
 */
export function useAssetHistory(
  assetId: string,
  kind: VehicleHistoryKind | undefined,
  limit: number,
  enabled = true,
) {
  const session = useActiveSession();
  const options = assetHistoryQueryOptions(session?.workspaceSlug, assetId, kind, limit);
  return useInfiniteQuery({ ...options, enabled: session !== undefined && enabled });
}

export function assetHistoryQueryOptions(
  workspaceSlug: string | undefined,
  assetId: string,
  kind: VehicleHistoryKind | undefined,
  limit: number,
) {
  return infiniteQueryOptions({
    queryKey: [...vehicleQueryKey(workspaceSlug, assetId), "history", kind ?? "ALL", limit],
    retry: retryUnlessNotFound,
    // Loaded by the route loader with these attempts; not repeated on mount (#496).
    retryOnMount: false,
    enabled: workspaceSlug !== undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: VehicleHistoryResponse) => last.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) =>
      getJson<VehicleHistoryResponse>(
        withQuery(`/v1/assets/${assetId}/history`, { kind, limit: String(limit), cursor: pageParam }),
        signal,
        "HISTORY",
      ),
  });
}

/** The meter's story, newest first; superseded readings stay listed and flagged. */
export function useAssetReadings(assetId: string, enabled: boolean) {
  const session = useActiveSession();
  return useInfiniteQuery<AssetReadingsResponse>({
    queryKey: [...vehicleQueryKey(session?.workspaceSlug, assetId), "readings"],
    retry: retryUnlessNotFound,
    enabled: session !== undefined && enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AssetReadingsResponse) => last.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) =>
      getJson(
        withQuery(`/v1/assets/${assetId}/readings`, { cursor: pageParam as string | undefined }),
        signal,
        "READINGS",
      ),
  });
}

/** Members who may hold the vehicle; people without a login never appear. */
export function useCustodianCandidates(assetId: string, enabled: boolean) {
  const session = useActiveSession();
  return useQuery<CustodianCandidatesResponse>({
    queryKey: [...vehicleQueryKey(session?.workspaceSlug, assetId), "custodian-candidates"],
    retry: retryUnlessNotFound,
    enabled: session !== undefined && enabled,
    queryFn: ({ signal }) =>
      getJson(`/v1/assets/${assetId}/custodian-candidates`, signal, "CUSTODIANS"),
  });
}

/** One signalement with its trail, for the record panel's deep link. */
export function useIssue(issueId: string, enabled = true) {
  const session = useActiveSession();
  return useQuery<IssueDetail>({
    queryKey: [...maintenanceQueryKey(session?.workspaceSlug), "issues", "detail", issueId],
    retry: retryUnlessNotFound,
    enabled: session !== undefined && enabled,
    queryFn: ({ signal }) => getJson(`/v1/issues/${issueId}`, signal, "ISSUE"),
  });
}

/**
 * The number of the work order or problem a panel shows, for a label naming it
 * from elsewhere ("Back to work order OT-0007", #608). The panels' own cache
 * entries, so a record just shown costs no request. Undefined while unknown.
 */
export function usePanelRecordNumber(ref: PanelRef | undefined): number | null | undefined {
  const session = useActiveSession();
  const id = ref === undefined || ref.kind === "readings" ? undefined : ref.id;
  const issue = useIssue(id ?? "", ref?.kind === "issue");
  const workOrder = useQuery<WorkOrderDetail>({
    queryKey: [...maintenanceQueryKey(session?.workspaceSlug), "work-orders", "detail", id],
    retry: retryUnlessNotFound,
    enabled: session !== undefined && ref?.kind === "work_order",
    queryFn: ({ signal }) => getJson(`/v1/work-orders/${id}`, signal, "WORK_ORDER"),
  });
  if (ref?.kind === "issue") return issue.data?.number;
  if (ref?.kind === "work_order") return workOrder.data?.number;
  return undefined;
}

/**
 * One note with its author's role and, for a note from Direction, who said
 * they saw it (#98). Under the vehicle's prefix, so an acknowledgement's
 * refresh reaches it with the To-do.
 */
export function useNote(assetId: string, noteId: string) {
  const session = useActiveSession();
  return useQuery<NoteDetail>({
    queryKey: [...vehicleQueryKey(session?.workspaceSlug, assetId), "notes", noteId],
    retry: retryUnlessNotFound,
    enabled: session !== undefined,
    queryFn: ({ signal }) => getJson(`/v1/notes/${noteId}`, signal, "NOTE"),
  });
}

/** The entries list, read through the vehicle: each row carries this vehicle's share. */
export interface VehicleEntriesFilter {
  status?: "LEDGER" | "SUBMITTED" | "REJECTED" | undefined;
  direction?: "EXPENSE" | "REVENUE" | undefined;
  periodCode?: string | undefined;
  economicMonth?: string | undefined;
  evidence?: "MISSING" | undefined;
}

/**
 * Not branch-scoped on purpose: a vehicle's page never narrows to the shell's
 * agency, and the server still reads entries against the caller's branches.
 */
export function useVehicleEntries(assetId: string, filter: VehicleEntriesFilter, enabled: boolean) {
  const session = useActiveSession();
  const params = { assetId, ...filter };
  return useInfiniteQuery<FinancialEntryListResponse>({
    queryKey: ["ws", session?.workspaceSlug, "finance", "entries", "vehicle", params],
    retry: retryUnlessNotFound,
    enabled: session !== undefined && enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: FinancialEntryListResponse) => last.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) =>
      getJson(
        withQuery("/v1/finance/entries", {
          ...params,
          cursor: pageParam as string | undefined,
        }),
        signal,
        "ENTRIES",
      ),
  });
}

/**
 * What a write on the vehicle refreshes: the vehicle's own reads, the
 * maintenance queue, finance, trips and the fleet list. The server decides what
 * each now says; nothing is patched locally.
 */
export function useVehicleRefresh(assetId: string) {
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const slug = session?.workspaceSlug;
  return async () => {
    await Promise.all(
      [
        vehicleQueryKey(slug, assetId),
        maintenanceQueryKey(slug),
        ["ws", slug, "finance"],
        ["ws", slug, "activities"],
        ["ws", slug, "assets"],
        ["ws", slug, "notes"],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}
