import type { CommandEnvelope, CommandWarningCode } from "@routiq/contracts";
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
 * activity, entry or sheet is being filed under — so the pipeline can compare
 * them against the actor's branch scope.
 *
 * Scope only. Whether a named branch still ACCEPTS work is deliberately decided
 * elsewhere: this runs before the idempotency lookup, and a refusal here answers
 * 422 to the exact retry of a command that already committed, which §5.3 says
 * must replay its original result. See `resolveTargetBranch`.
 */
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

export interface TargetBranch {
  branch: { id: string; code: string };
  warnings: CommandWarningCode[];
}

/**
 * The branch a new record is being filed under, resolved where §5.3 puts
 * reference validation — after the idempotency lookup, inside the handler — and
 * carrying the deactivation rule with it, so the two cannot drift apart.
 *
 * A deactivated branch takes no new record, EXCEPT from a device replaying what
 * it captured while the branch was still open. §6 does not let the server reject
 * reality: the trip happened and the fuel was bought before the admin closed the
 * branch. Those commit and carry BRANCH_INACTIVE_AT_COMMIT, which the receipt
 * keeps forever — every row reaches it through `created_by_command_id`, so the
 * discrepancy survives without a column of its own.
 *
 * Only OFFLINE_SYNC gets that latitude. A live submission naming a branch the
 * operator can see is closed is a mistake, not a fact from the past.
 *
 * Deliberately NOT applied to `assetBranchIds`: that resolver answers "where
 * does this asset live now", and the whole point of deactivating a branch is to
 * move its assets out of it. Guarding there would strand them.
 */
export async function resolveTargetBranch(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  branchCode: string,
): Promise<TargetBranch> {
  const [row] = await tx
    .select({ id: branches.id, code: branches.code, active: branches.active })
    .from(branches)
    .where(and(eq(branches.workspaceId, ctx.workspaceId), eq(branches.code, branchCode)))
    .limit(1);
  if (!row) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "branch",
      referenceCode: branchCode,
    });
  }

  const branch = { id: row.id, code: row.code };
  if (row.active) return { branch, warnings: [] };
  if (envelope.origin !== "OFFLINE_SYNC") {
    throw new CommandError(422, "BRANCH_INACTIVE", { branchCode });
  }
  return { branch, warnings: ["BRANCH_INACTIVE_AT_COMMIT"] };
}
