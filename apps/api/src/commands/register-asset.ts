import { registerAssetPayload } from "@asset/contracts";
import type { z } from "zod";
import { and, eq } from "drizzle-orm";
import { assets, branches } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";

type RegisterAssetPayload = z.infer<typeof registerAssetPayload>;

const registerAsset: CommandDefinition<RegisterAssetPayload> = {
  name: "register-asset",
  version: 1,
  module: "ASSETS",
  allowedRoles: ["ADMIN", "OPS_MANAGER"],
  payloadSchema: registerAssetPayload,
  async approvalContext(_tx, _ctx, payload) {
    return {
      branchCode: payload.branchCode,
      categoryCode: payload.assetClassCode,
      ...(payload.acquisitionAmountMinor === undefined
        ? {}
        : { amountMinor: payload.acquisitionAmountMinor }),
    };
  },
  async execute(tx, ctx, envelope, payload) {
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.workspaceId, ctx.workspaceId), eq(branches.code, payload.branchCode)))
      .limit(1);

    if (!branch) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "branch",
        referenceCode: payload.branchCode,
      });
    }

    const customValues: Record<string, unknown> = { ...payload.customValues };
    if (payload.capacityValue !== undefined) customValues["capacityValue"] = payload.capacityValue;
    if (payload.capacityUnit !== undefined) customValues["capacityUnit"] = payload.capacityUnit;

    await tx.insert(assets).values({
      id: payload.assetId,
      workspaceId: ctx.workspaceId,
      branchId: branch.id,
      assetCode: payload.assetCode,
      assetClassCode: payload.assetClassCode,
      templateCode: payload.templateCode,
      ...(payload.registrationNumber === undefined
        ? {}
        : { registrationNumber: payload.registrationNumber }),
      ...(payload.chassisNumber === undefined ? {} : { chassisNumber: payload.chassisNumber }),
      ...(payload.manufacturer === undefined ? {} : { manufacturer: payload.manufacturer }),
      ...(payload.model === undefined ? {} : { model: payload.model }),
      ...(payload.modelYear === undefined ? {} : { modelYear: payload.modelYear }),
      ...(payload.acquisitionDate === undefined
        ? {}
        : { acquisitionDate: payload.acquisitionDate }),
      ...(payload.acquisitionAmountMinor === undefined
        ? {}
        : { acquisitionAmountMinor: BigInt(payload.acquisitionAmountMinor) }),
      customValues,
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "asset.registered",
      entityType: "asset",
      entityId: payload.assetId,
      afterState: {
        id: payload.assetId,
        workspaceId: ctx.workspaceId,
        branchId: branch.id,
        assetCode: payload.assetCode,
        assetClassCode: payload.assetClassCode,
        templateCode: payload.templateCode,
        lifecycleStatus: "REGISTERED",
        registrationNumber: payload.registrationNumber ?? null,
        chassisNumber: payload.chassisNumber ?? null,
        manufacturer: payload.manufacturer ?? null,
        model: payload.model ?? null,
        modelYear: payload.modelYear ?? null,
        acquisitionDate: payload.acquisitionDate ?? null,
        acquisitionAmountMinor: payload.acquisitionAmountMinor ?? null,
        currency: "XAF",
        customValues,
        rowVersion: 1,
      },
      changedFields: [
        "id",
        "workspaceId",
        "branchId",
        "assetCode",
        "assetClassCode",
        "templateCode",
        "lifecycleStatus",
        "registrationNumber",
        "chassisNumber",
        "manufacturer",
        "model",
        "modelYear",
        "acquisitionDate",
        "acquisitionAmountMinor",
        "currency",
        "customValues",
        "rowVersion",
      ],
    });

    return { recordId: payload.assetId, rowVersion: 1 };
  },
};

registerCommand(registerAsset);
