import { useQuery } from "@tanstack/react-query";
import type { ComingUpResponse, TodoResponse } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";

async function readAttention(path: string, token: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(path, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`FLEET_ATTENTION_${response.status}`);
  return (await response.json()) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Structural, like every read here: the server's schema already holds the details. */
export function isTodoResponse(value: unknown): value is TodoResponse {
  return (
    isRecord(value) &&
    typeof value["businessDate"] === "string" &&
    Array.isArray(value["rows"]) &&
    typeof value["totalCount"] === "number"
  );
}

export function isComingUpResponse(value: unknown): value is ComingUpResponse {
  return (
    isRecord(value) &&
    typeof value["businessDate"] === "string" &&
    typeof value["windowDays"] === "number" &&
    Array.isArray(value["rows"]) &&
    typeof value["totalCount"] === "number" &&
    Array.isArray(value["notCounted"])
  );
}

export async function fetchTodo(token: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<TodoResponse> {
  const body = await readAttention("/v1/todo", token, signal, fetchImpl);
  if (!isTodoResponse(body)) throw new Error("TODO_SHAPE");
  return body;
}

export async function fetchComingUp(
  token: string,
  days: 14 | 30,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ComingUpResponse> {
  const body = await readAttention(`/v1/coming-up?days=${days}`, token, signal, fetchImpl);
  if (!isComingUpResponse(body)) throw new Error("COMING_UP_SHAPE");
  return body;
}

/**
 * The fleet's To do (`GET /v1/todo`, #661). Never branch-narrowed: attention
 * counts the caller's whole Branch Scope (CONTEXT.md), so the shell's agency
 * is not in the key. `enabled` carries the caller's role check: the read
 * refuses the roles no row waits on.
 */
export function useTodo(enabled = true) {
  const session = useActiveSession();
  return useQuery<TodoResponse>({
    queryKey: ["ws", session?.workspaceSlug, "attention", "todo"],
    enabled: enabled && session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchTodo(token, signal);
    },
  });
}

/** What falls due in the next `days` (`GET /v1/coming-up`, #661); the whole Branch Scope, like To do. */
export function useComingUp(days: 14 | 30, enabled = true) {
  const session = useActiveSession();
  return useQuery<ComingUpResponse>({
    queryKey: ["ws", session?.workspaceSlug, "attention", "coming-up", days],
    enabled: enabled && session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchComingUp(token, days, signal);
    },
  });
}
