import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ComingUpResponse, TodoResponse } from "@routiq/contracts";
import { useActiveSession } from "../auth/store.js";
import { authed } from "../lib/list-query.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRows(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((row) => isRecord(row) && typeof row["code"] === "string" && isRecord(row["link"]) && isRecord(row["params"]))
  );
}

/** Structural, like every read here: the server's schema already holds the details. */
export function isTodoResponse(value: unknown): value is TodoResponse {
  return (
    isRecord(value) &&
    typeof value["businessDate"] === "string" &&
    isRows(value["rows"]) &&
    typeof value["totalCount"] === "number"
  );
}

export function isComingUpResponse(value: unknown): value is ComingUpResponse {
  return (
    isRecord(value) &&
    typeof value["businessDate"] === "string" &&
    isRows(value["rows"]) &&
    typeof value["totalCount"] === "number" &&
    Array.isArray(value["notCounted"])
  );
}

async function fetchRead<T>(
  path: string,
  token: string,
  guard: (value: unknown) => value is T,
  label: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(path, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`${label}_${response.status}`);
  const body: unknown = await response.json();
  if (!guard(body)) throw new Error(`${label}_SHAPE`);
  return body;
}

export function fetchTodo(token: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<TodoResponse> {
  return fetchRead("/v1/todo", token, isTodoResponse, "TODO", signal, fetchImpl);
}

export function fetchComingUp(
  token: string,
  days: 14 | 30,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<ComingUpResponse> {
  return fetchRead(`/v1/coming-up?days=${days}`, token, isComingUpResponse, "COMING_UP", signal, fetchImpl);
}

/**
 * The To do rows for the caller's whole Branch Scope (`GET /v1/todo`, #661).
 * The shell's branch never narrows them (CONTEXT.md, Ambient Branch), so the
 * key carries no branch. Under the `finance` key too, so a decision on an
 * entry refreshes the approvals row.
 */
export function useTodo(enabled = true) {
  const session = useActiveSession();
  return useQuery({ ...todoQueryOptions(session?.workspaceSlug), enabled: enabled && session !== undefined });
}

export function todoQueryOptions(workspaceSlug: string | undefined) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "finance", "todo"],
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchTodo(token, signal)),
  });
}

/** What falls due in the next `days` days (`GET /v1/coming-up`), whole Branch Scope. */
export function useComingUp(days: 14 | 30 = 14, enabled = true) {
  const session = useActiveSession();
  return useQuery({ ...comingUpQueryOptions(session?.workspaceSlug, days), enabled: enabled && session !== undefined });
}

export function comingUpQueryOptions(workspaceSlug: string | undefined, days: 14 | 30) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "coming-up", days],
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchComingUp(token, days, signal)),
  });
}
