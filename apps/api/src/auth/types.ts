import type { BranchScope, PrincipalType, Role } from "@routiq/contracts";

/** What verifying a bearer token yields — nothing provider-specific may leak past this. */
export interface VerifiedIdentity {
  principalId: string;
  workspaceId: string;
}

/**
 * Narrow identity-verification seam (ARCHITECTURE.md §6a guard 1).
 * Local sessions implement it today (username/PIN, tests, on-prem);
 * Supabase Auth becomes another implementation behind the same interface.
 */
export interface IdentityProvider {
  verifyToken(token: string): Promise<VerifiedIdentity | null>;
}

/** Server-derived actor context. Never constructed from client-supplied tenant/actor fields. */
export interface AuthContext {
  workspaceId: string;
  principalId: string;
  principalType: PrincipalType;
  membershipId: string;
  role: Role;
  branchScope: BranchScope;
}

/**
 * The vendor operator running a platform-scope command. A separate type rather
 * than an AuthContext with nullable workspace fields: tenant handlers keep a
 * context whose workspaceId, membership and role always exist, so none of them
 * has to be defensive about an actor that provisioning invented.
 */
export interface OperatorContext {
  kind: "platform";
  principalId: string;
  principalType: "VENDOR_OPERATOR";
  displayName: string;
}

export type CommandActorContext = AuthContext | OperatorContext;

export function isOperatorContext(ctx: CommandActorContext): ctx is OperatorContext {
  return "kind" in ctx && ctx.kind === "platform";
}
