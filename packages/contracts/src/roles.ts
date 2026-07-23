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

export const PRINCIPAL_TYPES = ["HUMAN", "AI_AGENT", "INTEGRATION"] as const;

export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

/** Branch scope of a membership: every branch in the workspace, or an explicit list. */
export type BranchScope = "ALL" | string[];
