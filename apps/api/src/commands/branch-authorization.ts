import { and, eq } from "drizzle-orm";
import { assets } from "../db/schema.js";
import type { CommandContext, Tx } from "./dispatcher.js";

/** Resolve the current/source branch of an asset for pipeline authorization. */
export async function assetBranchIds(
  tx: Tx,
  ctx: CommandContext,
  assetId: string,
): Promise<readonly string[]> {
  const [asset] = await tx
    .select({ branchId: assets.branchId })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, assetId),
      ),
    );
  return asset ? [asset.branchId] : [];
}
