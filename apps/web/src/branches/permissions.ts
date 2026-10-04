import type { Role } from "@routiq/contracts";

/**
 * Which branches exist is a settings question, the Director's alone: the three
 * branch commands are DIRECTOR-only, so anyone else is offered no entry at all
 * rather than a screen that answers 403.
 *
 * No module gate — branches are CORE, which cannot be disabled.
 */
export function canAdministerBranches(role: Role | undefined): boolean {
  return role === "DIRECTOR";
}
