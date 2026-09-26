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
 * Who may read finance data: the ledger, entry detail, the approvals queue,
 * periods and the dashboard's finance figures. MAINTENANCE may not (#59).
 * The API enforces it; the web hides what the API would refuse.
 */
export const FINANCE_READ_ROLES = [
  "ADMIN",
  "OPS_MANAGER",
  "FINANCE_APPROVER",
  "FIELD_SUBMITTER",
  "EXECUTIVE_VIEWER",
] as const satisfies readonly Role[];

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
