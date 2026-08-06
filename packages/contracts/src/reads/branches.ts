import { z } from "zod";
import { listResponse } from "./list.js";

/** Fields `/v1/branches` may be sorted by; `sort` outside this set is rejected. */
export const branchListSortFields = ["code"] as const;

/**
 * A branch as the administration screen shows it. Inactive branches are part of
 * the list rather than hidden behind a filter: there are a handful of them, and
 * reactivating one is the reason an admin opens this screen at all.
 *
 * `code` is immutable — it is embedded in every record number the branch has
 * printed (`DLA-2026-00004`) — so it is shown but never edited.
 */
export const branchListItem = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  timezone: z.string(),
  active: z.boolean(),
  /** So a row action can send it as expectedVersion. */
  rowVersion: z.number().int().positive(),
});

export const branchListResponse = listResponse(branchListItem);

export type BranchListItem = z.infer<typeof branchListItem>;
export type BranchListSortField = (typeof branchListSortFields)[number];
