import type { Role } from "@routiq/contracts";

/**
 * Which branches exist is the admin's question alone: `/v1/branches` and the
 * three branch commands are all ADMIN-only, so a non-admin is offered no entry
 * at all rather than a screen that answers 403.
 *
 * No module gate — branches are CORE, which cannot be disabled.
 */
export function canAdministerBranches(role: Role | undefined): boolean {
  return role === "ADMIN";
}
