import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  APPROVAL_CHAIN_COMMAND_TYPES,
  APPROVAL_CHAIN_OUTCOMES,
  type ApprovalChainResponse,
} from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";

const COMMAND_TYPES: ReadonlySet<string> = new Set(APPROVAL_CHAIN_COMMAND_TYPES);
const OUTCOMES: ReadonlySet<string> = new Set(APPROVAL_CHAIN_OUTCOMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStep(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value["upToMinor"] === null || typeof value["upToMinor"] === "number") &&
    typeof value["outcome"] === "string" &&
    OUTCOMES.has(value["outcome"])
  );
}

function isChain(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["commandType"] === "string" &&
    COMMAND_TYPES.has(value["commandType"]) &&
    Array.isArray(value["steps"]) &&
    value["steps"].every(isStep)
  );
}

function isNotice(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value["changeId"] === "string" &&
      typeof value["changedAt"] === "string" &&
      (value["changedBy"] === null || typeof value["changedBy"] === "string"))
  );
}

export function isApprovalChainResponse(value: unknown): value is ApprovalChainResponse {
  return (
    isRecord(value) &&
    typeof value["currency"] === "string" &&
    Array.isArray(value["chains"]) &&
    value["chains"].every(isChain) &&
    isNotice(value["notice"])
  );
}

export async function fetchApprovalChain(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalChainResponse> {
  const response = await fetchImpl("/v1/approval-chain", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`APPROVAL_CHAIN_${response.status}`);
  const body: unknown = await response.json();
  if (!isApprovalChainResponse(body)) throw new Error("APPROVAL_CHAIN_SHAPE");
  return body;
}

export function approvalChainKey(workspaceSlug: string | undefined) {
  return ["ws", workspaceSlug, "approval-chain"] as const;
}

/**
 * The caller's own approval chain and the rules notice they have not
 * dismissed (#422). Refetched on focus, so a change Direction makes reaches an
 * open screen on the member's next visit to it.
 */
export function useApprovalChain() {
  return useQuery(approvalChainQueryOptions(useActiveSession()?.workspaceSlug));
}

/** Also loaded by the shell before it draws, so the rules notice is there at first paint or not at all (#495). */
export function approvalChainQueryOptions(workspaceSlug: string | undefined) {
  return queryOptions({
    queryKey: approvalChainKey(workspaceSlug),
    enabled: workspaceSlug !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchApprovalChain(token, signal);
    },
  });
}

/**
 * Asks for the chain again on every new screen, so a change Direction makes
 * reaches a member already in the app on their next screen (#422). A router
 * subscription rather than a pathname read: the shell must not re-render on
 * navigation. Invalidating rather than refetching, so after sign-out, when the
 * cache is empty, nothing comes back under the ended session.
 */
export function useRecheckApprovalChainOnNavigation(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceSlug = useActiveSession()?.workspaceSlug;
  useEffect(
    () =>
      router.subscribe("onResolved", (event) => {
        if (!event.pathChanged) return;
        void queryClient.invalidateQueries({ queryKey: approvalChainKey(workspaceSlug) });
      }),
    [router, queryClient, workspaceSlug],
  );
}
