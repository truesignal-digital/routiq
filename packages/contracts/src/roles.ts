import { z } from "zod";

/**
 * Fixed role registry (ADR-0009, ARCHITECTURE.md §10). Code-level, never tenant
 * data: a workspace cannot add, rename, or re-permission roles. What each role
 * may do is docs/reference/roles-and-access.md.
 */
export const ROLES = [
  "DIRECTOR",
  "ADMIN",
  "FINANCE",
  "CASHIER",
  "TECHNICIAN",
  "DRIVER",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * The roles shipped before ADR-0009, and the plain map that replaced them
 * (owner decision 2026-10-04: it promotes nobody). Migration 0036 applies the
 * same map to stored rows. Kept so a payload written against a shipped command
 * version still validates; nothing stores these codes any more.
 */
export const LEGACY_ROLE_MAP = {
  ADMIN: "ADMIN",
  OPS_MANAGER: "ADMIN",
  EXECUTIVE_VIEWER: "ADMIN",
  FIELD_SUBMITTER: "DRIVER",
  MAINTENANCE: "TECHNICIAN",
  FINANCE_APPROVER: "FINANCE",
} as const satisfies Record<string, Role>;

export type LegacyRole = keyof typeof LEGACY_ROLE_MAP;

export const LEGACY_ROLES = [
  "ADMIN",
  "OPS_MANAGER",
  "FIELD_SUBMITTER",
  "MAINTENANCE",
  "FINANCE_APPROVER",
  "EXECUTIVE_VIEWER",
] as const satisfies readonly LegacyRole[];

/**
 * The role field of a command version shipped before ADR-0009: exactly the
 * legacy codes it accepted, each read as the role it became. A client still
 * posting v1 lands its user on the same role the migration gave everyone else.
 */
export const legacyRoleInput = z
  .enum(LEGACY_ROLES)
  .transform((code): Role => LEGACY_ROLE_MAP[code]);

/**
 * Roles that may read ledger figures. Interim set: the pre-ADR-0009 readers
 * mapped one for one. The read-gates slice narrows DRIVER to their own records
 * and adds CASHIER for their branch's entries. TECHNICIAN is left out on
 * purpose: the workshop sees the cost lines of its own work orders, never the
 * books. The web's `canReadFinance` mirrors this list.
 */
export const FINANCE_READER_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "FINANCE",
  "DRIVER",
] as const satisfies readonly Role[];

export function canReadLedger(role: Role): boolean {
  return (FINANCE_READER_ROLES as readonly Role[]).includes(role);
}

/** Who may open member administration at all. */
export const MEMBER_ADMIN_ROLES = ["DIRECTOR", "ADMIN"] as const satisfies readonly Role[];

/** The roles an ADMIN may give, change or remove, in their own branches (ADR-0009). */
export const ADMIN_GRANTABLE_ROLES = [
  "DRIVER",
  "TECHNICIAN",
  "CASHIER",
] as const satisfies readonly Role[];

/**
 * Roles an actor may hand out or take away. DIRECTOR manages every role; ADMIN
 * only the field roles; everyone else none. The server enforces this on every
 * member command; the web uses it to fill the role picker.
 */
export function grantableRoles(actorRole: Role): readonly Role[] {
  if (actorRole === "DIRECTOR") return ROLES;
  if (actorRole === "ADMIN") return ADMIN_GRANTABLE_ROLES;
  return [];
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
