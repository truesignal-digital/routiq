import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { AuthContext } from "../auth/types.js";
import { assets } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { notFound } from "./read-gate.js";

export interface ScopedAsset {
  id: string;
  branchId: string;
  lifecycleStatus: (typeof assets.$inferSelect)["lifecycleStatus"];
  templateCode: (typeof assets.$inferSelect)["templateCode"];
  custodianMembershipId: string | null;
  rowVersion: number;
}

/**
 * The vehicle a read hangs off, by the asset detail's own predicates: the
 * caller's workspace, and their branches unless they hold all of them.
 * Undefined covers "no such asset" and "not yours" alike — a 403 would confirm
 * the row exists elsewhere.
 */
export async function loadScopedAsset(
  tx: TenantTx,
  auth: AuthContext,
  assetId: string,
): Promise<ScopedAsset | undefined> {
  const conditions: SQL[] = [eq(assets.workspaceId, auth.workspaceId), eq(assets.id, assetId)];
  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(assets.branchId, auth.branchScope));
  }
  const [asset] = await tx
    .select({
      id: assets.id,
      branchId: assets.branchId,
      lifecycleStatus: assets.lifecycleStatus,
      templateCode: assets.templateCode,
      custodianMembershipId: assets.custodianMembershipId,
      rowVersion: assets.rowVersion,
    })
    .from(assets)
    .where(and(...conditions))
    .limit(1);
  return asset;
}

/** `loadScopedAsset`, refusing 404 REFERENCE_NOT_FOUND when the vehicle is out of reach. */
export async function requireScopedAsset(
  tx: TenantTx,
  auth: AuthContext,
  assetId: string,
): Promise<ScopedAsset> {
  const asset = await loadScopedAsset(tx, auth, assetId);
  if (!asset) throw notFound();
  return asset;
}
