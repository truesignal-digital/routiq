import { and, eq } from "drizzle-orm";
import type {
  CommandDefinition,
} from "./dispatcher.js";
import {
  appendAuditEvent,
  CommandError,
  checkOptimisticVersion,
  registerCommand,
} from "./dispatcher.js";
import {
  assignAssetPayload,
  commissionAssetPayload,
  type AssignAssetPayload,
  type CommissionAssetPayload,
} from "@routiq/contracts";
import { assets, branches, memberships } from "../db/schema.js";
import {
  updateAssetAtVersion,
  type AssetVersionedChanges,
} from "./versioned-write.js";
import { assetBranchIds } from "./branch-authorization.js";

export const commissionAsset: CommandDefinition<CommissionAssetPayload> = {
  name: "commission-asset",
  module: "ASSETS",
  version: 1,
  allowedRoles: ["ADMIN", "OPS_MANAGER"],
  payloadSchema: commissionAssetPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) =>
      assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async execute(tx, ctx, envelope, payload) {
    const asset = await tx.query.assets.findFirst({
      where: and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, payload.assetId),
      ),
    });

    if (!asset) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "asset",
        referenceCode: payload.assetId,
      });
    }

    checkOptimisticVersion(envelope, asset.rowVersion);

    if (asset.lifecycleStatus !== "REGISTERED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: asset.lifecycleStatus,
        to: "IN_SERVICE",
      });
    }

    const commissionedAt =
      payload.commissionedAt ? new Date(payload.commissionedAt) : new Date();
    const updated = await updateAssetAtVersion(tx, ctx, envelope, asset.id, {
      lifecycleStatus: "IN_SERVICE",
      commissionedAt,
    });

    const beforeState = {
      lifecycleStatus: asset.lifecycleStatus,
      commissionedAt: asset.commissionedAt,
      rowVersion: asset.rowVersion,
    };
    const afterState = {
      lifecycleStatus: "IN_SERVICE",
      commissionedAt: updated.commissionedAt,
      rowVersion: updated.rowVersion,
    };

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "asset.commissioned",
      entityType: "asset",
      entityId: asset.id,
      beforeState,
      afterState,
      changedFields: ["lifecycleStatus", "commissionedAt", "rowVersion"],
    });

    return {
      recordId: asset.id,
      rowVersion: updated.rowVersion,
    };
  },
};

/**
 * A move INTO a branch is a new write into it, so a deactivated one refuses the
 * arrival — the rule `resolveTargetBranch` applies to every branch-targeting
 * FACT, reaching the one command whose target is a decision. No offline latitude
 * here for the same reason: a transfer is a judgement about where the fleet
 * stands now, not a fact from the past. Moving an asset OUT of a deactivated
 * branch stays untouched: that transfer is the reason a branch is deactivated in
 * the first place.
 *
 * Checked from `approvalContext` rather than only from `execute` so a doomed
 * move never has an approval computed for it. Under the catalog defaults a
 * cross-branch transfer matches the CROSS_BRANCH rule and answers
 * APPROVAL_REQUIRED before the handler runs at all, which would send a human
 * approver chasing a move that could never commit.
 */
function assertBranchAcceptsArrival(
  target: typeof branches.$inferSelect,
  currentBranchId: string,
  branchCode: string,
): void {
  if (target.id !== currentBranchId && !target.active) {
    throw new CommandError(422, "BRANCH_INACTIVE", { branchCode });
  }
}

export const assignAsset: CommandDefinition<AssignAssetPayload> = {
  name: "assign-asset",
  module: "ASSETS",
  version: 1,
  /**
   * FINANCE_APPROVER is here for the cross-branch transfer alone. The seeded
   * CROSS_BRANCH rule names them as the approving role, and `allowedRoles` is
   * checked before approval is ever evaluated — so without this the rule was
   * unsatisfiable by every role in the workspace and a transfer between branches
   * could not be completed by anyone.
   *
   * It does not widen ordinary assignment: a same-branch move matches only the
   * two wildcard rules (ADMIN, OPS_MANAGER), neither of which authorizes
   * FINANCE_APPROVER, so they are answered APPROVAL_REQUIRED as before.
   */
  allowedRoles: ["ADMIN", "OPS_MANAGER", "FINANCE_APPROVER"],
  payloadSchema: assignAssetPayload,
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    // Source branch only: the target branch is governed by the CROSS_BRANCH
    // approval rule, not by scope. Including it here would make that rule
    // unreachable for branch-scoped actors.
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async approvalContext(tx, ctx, payload) {
    const asset = await tx.query.assets.findFirst({
      where: and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, payload.assetId),
      ),
    });

    if (!asset) {
      return {};
    }

    if (payload.branchCode) {
      const targetBranch = await tx.query.branches.findFirst({
        where: and(
          eq(branches.workspaceId, ctx.workspaceId),
          eq(branches.code, payload.branchCode),
        ),
      });

      if (targetBranch && asset.branchId !== targetBranch.id) {
        assertBranchAcceptsArrival(targetBranch, asset.branchId, payload.branchCode);
        return { branchCode: payload.branchCode, categoryCode: "CROSS_BRANCH" };
      }
    }

    return payload.branchCode ? { branchCode: payload.branchCode } : {};
  },

  async execute(tx, ctx, envelope, payload) {
    const asset = await tx.query.assets.findFirst({
      where: and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, payload.assetId),
      ),
    });

    if (!asset) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "asset",
        referenceCode: payload.assetId,
      });
    }

    checkOptimisticVersion(envelope, asset.rowVersion);

    let newBranchId = asset.branchId;
    let newCustodianMembershipId = asset.custodianMembershipId;

    if (payload.branchCode) {
      const branch = await tx.query.branches.findFirst({
        where: and(
          eq(branches.workspaceId, ctx.workspaceId),
          eq(branches.code, payload.branchCode),
        ),
      });

      if (!branch) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "branch",
          referenceCode: payload.branchCode,
        });
      }

      // Already refused in approvalContext; repeated on the write path so the
      // invariant does not depend on an optional hook staying declared.
      assertBranchAcceptsArrival(branch, asset.branchId, payload.branchCode);

      newBranchId = branch.id;
    }

    if (payload.custodianMembershipId) {
      const membership = await tx.query.memberships.findFirst({
        where: and(
          eq(memberships.workspaceId, ctx.workspaceId),
          eq(memberships.id, payload.custodianMembershipId),
        ),
      });

      if (!membership) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "membership",
          referenceCode: payload.custodianMembershipId,
        });
      }

      newCustodianMembershipId = membership.id;
    }

    const updateData: AssetVersionedChanges = {};
    const changedFields: string[] = ["rowVersion"];

    if (newBranchId !== asset.branchId) {
      updateData.branchId = newBranchId;
      changedFields.push("branchId");
    }

    if (newCustodianMembershipId !== asset.custodianMembershipId) {
      updateData.custodianMembershipId = newCustodianMembershipId;
      changedFields.push("custodianMembershipId");
    }

    const updated = await updateAssetAtVersion(
      tx,
      ctx,
      envelope,
      asset.id,
      updateData,
    );

    const beforeState = {
      branchId: asset.branchId,
      custodianMembershipId: asset.custodianMembershipId,
      rowVersion: asset.rowVersion,
    };
    const afterState = {
      branchId: newBranchId,
      custodianMembershipId: newCustodianMembershipId,
      rowVersion: updated.rowVersion,
    };

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "asset.assigned",
      entityType: "asset",
      entityId: asset.id,
      beforeState,
      afterState,
      changedFields,
    });

    return {
      recordId: asset.id,
      rowVersion: updated.rowVersion,
    };
  },
};

registerCommand(commissionAsset);
registerCommand(assignAsset);
