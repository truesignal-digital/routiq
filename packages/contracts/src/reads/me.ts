import { z } from "zod";
import { MODULE_CODES } from "../modules.js";
import { PRINCIPAL_TYPES, ROLES } from "../roles.js";
import { TEMPLATE_CODES } from "../templates.js";

/**
 * `/v1/me`: who is signed in and what their workspace switched on. The auth
 * context is server-derived; the two names are there so the shell can say who
 * you are ("Sali Ahmadou", "Transports Ngwa") instead of a login and a slug.
 */
export const meResponse = z.object({
  workspaceId: z.uuid(),
  principalId: z.uuid(),
  principalType: z.enum(PRINCIPAL_TYPES),
  membershipId: z.uuid(),
  role: z.enum(ROLES),
  branchScope: z.union([z.literal("ALL"), z.array(z.uuid())]),
  /** The member's own name, as the people list shows it. */
  displayName: z.string().min(1),
  /** The company's name, not its sign-in slug. */
  workspaceName: z.string().min(1),
  enabledModules: z.array(z.enum(MODULE_CODES)),
  /**
   * Workspaces provisioned before `provision-workspace` existed are
   * grandfathered to every preset, so this is never empty.
   */
  enabledPresets: z.array(z.enum(TEMPLATE_CODES)).min(1),
});

export type MeResponse = z.infer<typeof meResponse>;
