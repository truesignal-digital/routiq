import type { BranchScope, PrincipalType, Role } from "@asset/contracts";

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
