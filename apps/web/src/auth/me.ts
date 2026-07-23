import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BranchScope, ModuleCode, PrincipalType, Role } from "@asset/contracts";
import { sessionStore, useActiveSession } from "./store.js";

export interface MeContext {
  workspaceId: string;
  principalId: string;
  principalType: PrincipalType;
  membershipId: string;
  role: Role;
  branchScope: BranchScope;
  enabledModules: ModuleCode[];
}

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

export function useMe() {
  const session = useActiveSession();
  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "me"],
    enabled: session !== undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      try {
        return await fetchMe(token, signal);
      } catch (error) {
        // A dead token means the session is over: drop it so the route
        // guard re-prompts the PIN instead of rendering a broken shell.
        if (error instanceof Error && error.message === "AUTH_REQUIRED" && session) {
          sessionStore.logout(session);
        }
        throw error;
      }
    },
  });
}

export const MeCtx = createContext<MeContext | undefined>(undefined);

/** Membership context for gating; undefined while /v1/me is loading. */
export function useMeContext(): MeContext | undefined {
  return useContext(MeCtx);
}

/** EXECUTIVE_VIEWER is the read-only role: zero mutating affordances. */
export function isReadOnlyRole(role: Role | undefined): boolean {
  return role === undefined || role === "EXECUTIVE_VIEWER";
}

/** Client-side branch gate — defense in depth over the server-side filter.
 * `scope` holds branch ids (as in MeContext.branchScope); `idOf` extracts the
 * comparable id from each item. */
export function scopedByBranch<T>(scope: BranchScope, items: T[], idOf: (item: T) => string): T[] {
  if (scope === "ALL") return items;
  return items.filter((item) => scope.includes(idOf(item)));
}
