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

export const assignAsset: CommandDefinition<AssignAssetPayload> = {
  name: "assign-asset",
  module: "ASSETS",
  version: 1,
  allowedRoles: ["ADMIN", "OPS_MANAGER"],
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

      /*
       * The target of a move is a new write into that branch, so a deactivated
       * one refuses it — the same rule `branchIdsByCode` applies to every other
       * branch-targeting command. It is checked here rather than in the resolver
       * because assign-asset resolves the SOURCE branch for scope (the target is
       * governed by the CROSS_BRANCH approval rule), and moving an asset OUT of
       * a deactivated branch is exactly what deactivation is for.
       */
      if (branch.id !== asset.branchId && !branch.active) {
        throw new CommandError(422, "BRANCH_INACTIVE", {
          branchCode: payload.branchCode,
        });
      }

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
