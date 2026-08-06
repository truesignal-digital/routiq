import { and, eq, inArray } from "drizzle-orm";
import { assets, branches } from "../db/schema.js";
import { CommandError, type CommandContext, type Tx } from "./dispatcher.js";

/** Resolve the current/source branches of assets for pipeline authorization. */
export async function assetBranchIds(
  tx: Tx,
  ctx: CommandContext,
  assetIds: readonly string[],
): Promise<readonly string[]> {
  if (assetIds.length === 0) return [];
  const rows = await tx
    .select({ branchId: assets.branchId })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        inArray(assets.id, [...new Set(assetIds)]),
      ),
    );
  return rows.map((row) => row.branchId);
}

/**
 * Resolve the branches a payload NAMES — the branch a new asset, person,
 * activity, entry or sheet is being filed under.
 *
 * This is also where a deactivated branch stops accepting work. Every
 * branch-targeting command reaches its target through here, so the rule lives in
 * one place instead of N handlers, and it runs before the receipt is written so
 * a rejected call leaves no half-state.
 *
 * Deliberately NOT in `assetBranchIds`: that resolver answers "where does this
 * asset live now", and the whole point of deactivating a branch is to move its
 * assets out of it. Guarding there would strand them.
 */
export async function branchIdsByCode(
  tx: Tx,
  ctx: CommandContext,
  branchCodes: readonly string[],
): Promise<readonly string[]> {
  if (branchCodes.length === 0) return [];
  const rows = await tx
    .select({ id: branches.id, code: branches.code, active: branches.active })
    .from(branches)
    .where(
      and(
        eq(branches.workspaceId, ctx.workspaceId),
        inArray(branches.code, [...new Set(branchCodes)]),
      ),
    );

  const inactive = rows.find((row) => !row.active);
  if (inactive) {
    throw new CommandError(422, "BRANCH_INACTIVE", { branchCode: inactive.code });
  }

  return rows.map((row) => row.id);
}
