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
} from "@asset/contracts";
import { assets, branches, memberships } from "../db/schema.js";

export const commissionAsset: CommandDefinition<CommissionAssetPayload> = {
  name: "commission-asset",
  module: "ASSETS",
  version: 1,
  allowedRoles: ["ADMIN", "OPS_MANAGER"],
  payloadSchema: commissionAssetPayload,

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
    const newRowVersion = (asset.rowVersion ?? 0) + 1;

    await tx.update(assets).set({
      lifecycleStatus: "IN_SERVICE",
      commissionedAt,
      rowVersion: newRowVersion,
    }).where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, payload.assetId),
      ),
    );

    const beforeState = {
      lifecycleStatus: asset.lifecycleStatus,
      commissionedAt: asset.commissionedAt,
      rowVersion: asset.rowVersion,
    };
    const afterState = {
      lifecycleStatus: "IN_SERVICE",
      commissionedAt,
      rowVersion: newRowVersion,
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
      rowVersion: newRowVersion,
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

    const newRowVersion = (asset.rowVersion ?? 0) + 1;
    const updateData: Record<string, unknown> = { rowVersion: newRowVersion };
    const changedFields: string[] = ["rowVersion"];

    if (newBranchId !== asset.branchId) {
      updateData.branchId = newBranchId;
      changedFields.push("branchId");
    }

    if (newCustodianMembershipId !== asset.custodianMembershipId) {
      updateData.custodianMembershipId = newCustodianMembershipId;
      changedFields.push("custodianMembershipId");
    }

    await tx.update(assets).set(updateData).where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, payload.assetId),
      ),
    );

    const beforeState = {
      branchId: asset.branchId,
      custodianMembershipId: asset.custodianMembershipId,
      rowVersion: asset.rowVersion,
    };
    const afterState = {
      branchId: newBranchId,
      custodianMembershipId: newCustodianMembershipId,
      rowVersion: newRowVersion,
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
      rowVersion: newRowVersion,
    };
  },
};

registerCommand(commissionAsset);
registerCommand(assignAsset);
