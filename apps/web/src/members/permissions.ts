import type { Role } from "@routiq/contracts";

/**
 * Who the workspace trusts is the admin's question alone: the five member
 * commands and `/v1/members` are both ADMIN-only, so a non-admin is offered no
 * Users entry at all rather than a screen that answers 403.
 *
 * No module gate — member administration is CORE, which cannot be disabled.
 */
export function canAdministerMembers(role: Role | undefined): boolean {
  return role === "ADMIN";
}
