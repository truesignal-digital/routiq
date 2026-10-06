import { createContext, useContext } from "react";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { BranchScope, MeResponse } from "@routiq/contracts";
import { endSession } from "./sign-out.js";
import { REFERENCE_STALE_MS } from "../lib/query-defaults.js";
import type { Identity } from "./session.js";
import { sessionStore, useActiveSession } from "./store.js";

/** The signed-in member as `/v1/me` describes them (`reads/me.ts` in contracts). */
export type MeContext = MeResponse;

export async function fetchMe(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<MeContext> {
  const response = await fetchImpl("/v1/me", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 401) throw new Error("AUTH_REQUIRED");
  if (!response.ok) throw new Error(`ME_${response.status}`);
  return (await response.json()) as MeContext;
}

/**
 * The signed-in member, read by the shell's loader before the shell draws
 * (#495) and by `useMe` after. A dead token means the session is over: it is
 * dropped with every read made under it, so the route guard re-prompts the
 * PIN instead of rendering a broken shell.
 */
export function meQueryOptions(queryClient: QueryClient, session: Identity | undefined) {
  return queryOptions({
    queryKey: ["ws", session?.workspaceSlug, "me"] as const,
    enabled: session !== undefined,
    retry: false,
    staleTime: REFERENCE_STALE_MS,
    queryFn: async ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      try {
        return await fetchMe(token, signal);
      } catch (error) {
        if (error instanceof Error && error.message === "AUTH_REQUIRED" && session) {
          endSession(queryClient, session);
        }
        throw error;
      }
    },
  });
}

export function useMe() {
  const session = useActiveSession();
  const queryClient = useQueryClient();
  return useQuery(meQueryOptions(queryClient, session));
}

export const MeCtx = createContext<MeContext | undefined>(undefined);

/** Membership context for gating; undefined while /v1/me is loading. */
export function useMeContext(): MeContext | undefined {
  return useContext(MeCtx);
}

/** Client-side branch gate — defense in depth over the server-side filter.
 * `scope` holds branch ids (as in MeContext.branchScope); `idOf` extracts the
 * comparable id from each item. */
export function scopedByBranch<T>(scope: BranchScope, items: T[], idOf: (item: T) => string): T[] {
  if (scope === "ALL") return items;
  return items.filter((item) => scope.includes(idOf(item)));
}
