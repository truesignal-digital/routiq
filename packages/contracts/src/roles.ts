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
 * How much of the money a role reads (ADR-0009, roles-and-access.md, "See
 * entries and the ledger"). Branch scope applies on top of every scope.
 * - LEDGER: the books: entries, vehicle totals, periods, the approvals queue.
 * - BRANCH_ENTRIES: the entries of the role's branches, no totals or periods.
 * - WORK_ORDER_COSTS: the cost lines of work orders, through the work-order
 *   reads, and the receipts and history of entries that are only such lines.
 * - OWN_ENTRIES: the expenses the member recorded, nothing summed over others.
 *   Never revenue: it is a trip's price, which a driver does not see (#593).
 */
export const MONEY_READ_SCOPES = [
  "LEDGER",
  "BRANCH_ENTRIES",
  "WORK_ORDER_COSTS",
  "OWN_ENTRIES",
] as const;

export type MoneyReadScope = (typeof MONEY_READ_SCOPES)[number];

export const MONEY_READ_SCOPE = {
  DIRECTOR: "LEDGER",
  ADMIN: "LEDGER",
  FINANCE: "LEDGER",
  CASHIER: "BRANCH_ENTRIES",
  TECHNICIAN: "WORK_ORDER_COSTS",
  DRIVER: "OWN_ENTRIES",
} as const satisfies Record<Role, MoneyReadScope>;

export function moneyReadScope(role: Role): MoneyReadScope {
  return MONEY_READ_SCOPE[role];
}

/**
 * Which trips a role reads (roles-and-access.md, Trips): every trip of its
 * branches, or only its own (ADR-0012 §3: recorded by them, planned for them,
 * or crewed by them as a driver). Branch scope applies on top of both.
 */
export const TRIP_READ_SCOPE = {
  DIRECTOR: "BRANCH_TRIPS",
  ADMIN: "BRANCH_TRIPS",
  FINANCE: "BRANCH_TRIPS",
  CASHIER: "BRANCH_TRIPS",
  TECHNICIAN: "BRANCH_TRIPS",
  DRIVER: "OWN_TRIPS",
} as const satisfies Record<Role, "BRANCH_TRIPS" | "OWN_TRIPS">;

export function readsOwnTripsOnly(role: Role): boolean {
  return TRIP_READ_SCOPE[role] === "OWN_TRIPS";
}

/**
 * Whether a role reads a work order's money: its estimate, its actual cost and
 * its cost lines. Every scope but OWN_ENTRIES: a work order's figures sum over
 * other people's entries, and a driver reads only the entries they recorded.
 */
export function canReadWorkOrderCosts(role: Role): boolean {
  return MONEY_READ_SCOPE[role] !== "OWN_ENTRIES";
}

/**
 * Who books parts and labour onto a work order (roles-and-access.md, "Add
 * parts and labour to a work order"): the workshop and the managers. Finance,
 * the Cashier (#414) and the driver (#410) record their own expenses, never on
 * a work order. The server refuses their lines that name one; the web does not
 * offer it.
 */
export const WORK_ORDER_COST_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "TECHNICIAN",
] as const satisfies readonly Role[];

export function canBookWorkOrderCost(role: Role): boolean {
  return (WORK_ORDER_COST_ROLES as readonly Role[]).includes(role);
}

/** The roles whose scope is LEDGER. The web's `canReadFinance` mirrors it. */
export const LEDGER_READER_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "FINANCE",
] as const satisfies readonly Role[];

export function canReadLedger(role: Role): boolean {
  return MONEY_READ_SCOPE[role] === "LEDGER";
}

/**
 * Who opens the money Overview (`GET /v1/finance/overview`, #660): the ledger
 * readers with profit, and the cashier with their branch's revenue and
 * expenses only (dashboards.html, "Who sees what"). Profit follows
 * `canReadLedger`.
 */
export const MONEY_OVERVIEW_READER_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "FINANCE",
  "CASHIER",
] as const satisfies readonly Role[];

/**
 * The roles that open the entries list and an entry's detail, each filtered by
 * its scope. The workshop reaches its cost lines through work orders instead.
 */
export const ENTRY_READER_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "FINANCE",
  "CASHIER",
  "DRIVER",
] as const satisfies readonly Role[];

export function canReadEntries(role: Role): boolean {
  return (ENTRY_READER_ROLES as readonly Role[]).includes(role);
}

/** Vehicle documents and their expiry: everyone but the counter (ADR-0009). */
export const DOCUMENT_READER_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "FINANCE",
  "TECHNICIAN",
  "DRIVER",
] as const satisfies readonly Role[];

export function canReadDocuments(role: Role): boolean {
  return (DOCUMENT_READER_ROLES as readonly Role[]).includes(role);
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
 * The roles DIRECTOR may give, change or remove: every role but DIRECTOR.
 * Direction is appointed by the vendor (`appoint-director`) or at provisioning,
 * never by a tenant command (ADR-0009).
 */
export const DIRECTOR_GRANTABLE_ROLES = [
  "ADMIN",
  "FINANCE",
  "CASHIER",
  "TECHNICIAN",
  "DRIVER",
] as const satisfies readonly Exclude<Role, "DIRECTOR">[];

/**
 * Roles an actor may hand out or take away. DIRECTOR manages every role but
 * its own; ADMIN only the field roles; everyone else none. The server enforces
 * this on every member command, on the member as they are and as they would
 * be; the web uses it to fill the role picker.
 */
export function grantableRoles(actorRole: Role): readonly Role[] {
  if (actorRole === "DIRECTOR") return DIRECTOR_GRANTABLE_ROLES;
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
