import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Identity } from "./session.js";
import { sessionStore, useActiveSession } from "./store.js";

/**
 * Ends the session and forgets every read made under it, the `me` profile
 * included. Reads are keyed by workspace, not by member, so whatever this
 * member loaded would otherwise render the next member's screens — and fire
 * the reads its role unlocks — until their own profile arrived.
 */
export function endSession(queryClient: QueryClient, identity: Identity | undefined): void {
  if (identity !== undefined) sessionStore.logout(identity);
  queryClient.clear();
}

/** Sign out and land on the login screen with nothing of this member left behind. */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useActiveSession();
  return () => {
    endSession(queryClient, session);
    void navigate({ to: "/login" });
  };
}
