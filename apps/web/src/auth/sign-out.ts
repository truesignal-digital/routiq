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

/** A 401 as the reads (`<READ>_401`), `/v1/me` and the commands report it. */
const SIGNED_OUT = /^(AUTH_REQUIRED|AUTH_INVALID_TOKEN)$|_401$/;

let endedBySignedOutAnswer = false;

/**
 * Any read or command answered 401: the token is dead (PIN reset, account
 * disabled, expiry), so the session ends here once and the shell sends the
 * member to sign in. The last identity stands in for a session that expired
 * on this device, which `getActive` no longer returns but nothing has removed.
 */
export function endSessionIfSignedOut(queryClient: QueryClient, reason: string): void {
  if (endedBySignedOutAnswer || !SIGNED_OUT.test(reason)) return;
  const identity = sessionStore.getActive() ?? sessionStore.getLastIdentity();
  if (identity === undefined) return;
  endedBySignedOutAnswer = true;
  endSession(queryClient, identity);
}

/** Whether the login screen should say the last session ended; reset by the next sign-in. */
export function sessionEndedNotice(): boolean {
  return endedBySignedOutAnswer;
}

export function clearSessionEndedNotice(): void {
  endedBySignedOutAnswer = false;
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
