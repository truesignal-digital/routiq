import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, type ApprovalThresholdsResponse } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { isApprovalChainResponse } from "../approval-rules/useApprovalChain.js";

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const isAmount = (value: unknown) => value === null || typeof value === "number";

function isRoleChain(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["role"] === "string" &&
    ROLE_SET.has(value["role"]) &&
    // The chains have the shape of the member's own chain read.
    isApprovalChainResponse({ currency: "XAF", chains: value["chains"], notice: null })
  );
}

function isOverride(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["commandType"] === "string" &&
    (value["branchName"] === null || typeof value["branchName"] === "string") &&
    (value["categoryCode"] === null || typeof value["categoryCode"] === "string") &&
    isAmount(value["amountMinMinor"]) &&
    isAmount(value["amountMaxMinor"]) &&
    typeof value["requiredRole"] === "string"
  );
}

function isLastChange(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value["changedAt"] === "string" &&
      (value["changedBy"] === null || typeof value["changedBy"] === "string"))
  );
}

export function isApprovalThresholdsResponse(value: unknown): value is ApprovalThresholdsResponse {
  return (
    isRecord(value) &&
    typeof value["currency"] === "string" &&
    typeof value["version"] === "number" &&
    isAmount(value["recordingThresholdMinor"]) &&
    isAmount(value["financeCeilingMinor"]) &&
    Array.isArray(value["roles"]) &&
    value["roles"].every(isRoleChain) &&
    Array.isArray(value["overrides"]) &&
    value["overrides"].every(isOverride) &&
    Array.isArray(value["affectedRoles"]) &&
    value["affectedRoles"].every((role) => typeof role === "string" && ROLE_SET.has(role)) &&
    isLastChange(value["lastChange"])
  );
}

export async function fetchApprovalThresholds(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalThresholdsResponse> {
  const response = await fetchImpl("/v1/approval-thresholds", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`APPROVAL_THRESHOLDS_${response.status}`);
  const body: unknown = await response.json();
  if (!isApprovalThresholdsResponse(body)) throw new Error("APPROVAL_THRESHOLDS_SHAPE");
  return body;
}

export function approvalThresholdsKey(workspaceSlug: string | undefined) {
  return ["ws", workspaceSlug, "approval-thresholds"] as const;
}

/** The money chain's two bands and what each role meets, for Direction (#354). */
export function useApprovalThresholds() {
  const session = useActiveSession();
  return useQuery({
    queryKey: approvalThresholdsKey(session?.workspaceSlug),
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchApprovalThresholds(token, signal);
    },
  });
}

export function useInvalidateApprovalThresholds() {
  const queryClient = useQueryClient();
  const workspaceSlug = useActiveSession()?.workspaceSlug;
  return () =>
    queryClient.invalidateQueries({ queryKey: approvalThresholdsKey(workspaceSlug) });
}
