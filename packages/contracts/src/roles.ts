/**
 * Fixed role registry (ARCHITECTURE.md §10). Code-level, never tenant data:
 * a workspace cannot add, rename, or re-permission roles.
 */
export const ROLES = [
  "ADMIN",
  "OPS_MANAGER",
  "FIELD_SUBMITTER",
  "MAINTENANCE",
  "FINANCE_APPROVER",
  "EXECUTIVE_VIEWER",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Roles that may read ledger figures. MAINTENANCE is left out on purpose: the
 * workshop sees the cost lines of its own work orders, never the books. The
 * server's vehicle reads gate money on this list; the web's `canReadFinance`
 * mirrors it.
 */
export const FINANCE_READER_ROLES = [
  "ADMIN",
  "OPS_MANAGER",
  "FIELD_SUBMITTER",
  "FINANCE_APPROVER",
  "EXECUTIVE_VIEWER",
] as const satisfies readonly Role[];

export function canReadLedger(role: Role): boolean {
  return (FINANCE_READER_ROLES as readonly Role[]).includes(role);
}

/**
 * VENDOR_OPERATOR is the only workspace-free principal: it holds no membership
 * and is accepted solely by platform-scope commands (provisioning). Same
 * restricted-principal seam ARCHITECTURE.md §7 plans for AI.
 */
export const PRINCIPAL_TYPES = [
  "HUMAN",
  "AI_AGENT",
  "INTEGRATION",
  "VENDOR_OPERATOR",
] as const;

export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

/** Branch scope of a membership: every branch in the workspace, or an explicit list. */
export type BranchScope = "ALL" | string[];
