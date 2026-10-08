import { z } from "zod";
import type { Role } from "../roles.js";

/**
 * Who each navigation count waits on (#322). A count means the viewer has to
 * act, so it goes only to the roles that make the decision: expenses waiting
 * for approval to the approvers, new problems to the people who handle them.
 */
export const NAV_COUNT_ROLES = {
  moneyWaiting: ["DIRECTOR", "FINANCE"],
  maintenanceNew: ["DIRECTOR", "ADMIN", "TECHNICIAN"],
} as const satisfies Record<string, readonly Role[]>;

export type NavCountKey = keyof typeof NAV_COUNT_ROLES;

export function waitsOn(key: NavCountKey, role: Role): boolean {
  return (NAV_COUNT_ROLES[key] as readonly Role[]).includes(role);
}

/**
 * `GET /v1/nav-counts`: what waits on the caller, counted by the server inside
 * the caller's branch scope. `null` means no count for this caller (module off
 * or a role that does not act there), never zero.
 */
export const navCountsResponse = z.object({
  /** SUBMITTED entries the caller may decide, never the caller's own. */
  moneyWaiting: z.number().int().nonnegative().nullable(),
  /** OPEN problems with no work order still moving. */
  maintenanceNew: z.number().int().nonnegative().nullable(),
});

export type NavCountsResponse = z.infer<typeof navCountsResponse>;
