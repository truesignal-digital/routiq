import { and, eq, inArray } from "drizzle-orm";
import { assets, branches } from "../db/schema.js";
import type { CommandContext, Tx } from "./dispatcher.js";

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

export async function branchIdsByCode(
  tx: Tx,
  ctx: CommandContext,
  branchCodes: readonly string[],
): Promise<readonly string[]> {
  if (branchCodes.length === 0) return [];
  const rows = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.workspaceId, ctx.workspaceId),
        inArray(branches.code, [...new Set(branchCodes)]),
      ),
    );
  return rows.map((row) => row.id);
}
