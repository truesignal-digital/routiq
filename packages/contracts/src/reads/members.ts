import { z } from "zod";
import { ROLES } from "../roles.js";
import { listResponse } from "./list.js";

/**
 * What the Users screen shows in the status column. Three states, one column,
 * because an admin looking at a row asks one question: can this person work?
 *
 * LOCKED is derived (`credentials.locked_until > now()`), never stored — it
 * expires on its own, and a stored copy would have to be swept. DEACTIVATED
 * wins over it: a revoked member who also happens to be locked out is revoked.
 */
export const memberStatuses = ["ACTIVE", "LOCKED", "DEACTIVATED"] as const;
export const memberStatus = z.enum(memberStatuses);

/** Fields `/v1/members` may be sorted by; `sort` outside this set is rejected. */
export const memberListSortFields = ["displayName"] as const;

export const memberListItem = z.object({
  principalId: z.uuid(),
  displayName: z.string(),
  /** Null for a member who holds a membership but was never given a login. */
  username: z.string().nullable(),
  role: z.enum(ROLES),
  branchScope: z.union([z.literal("ALL"), z.array(z.uuid())]),
  status: memberStatus,
  /** The membership's, so a row action can send it as expectedVersion. */
  rowVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const memberListResponse = listResponse(memberListItem);

export type MemberStatus = z.infer<typeof memberStatus>;
export type MemberListItem = z.infer<typeof memberListItem>;
export type MemberListSortField = (typeof memberListSortFields)[number];
