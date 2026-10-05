import { registerAssetPayload } from "@routiq/contracts";
import type { z } from "zod";
import { and, eq } from "drizzle-orm";
import { assets, categories } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { branchIdsByCode, resolveTargetBranch } from "./branch-authorization.js";
import { validateCustomValues } from "./templates.js";

type RegisterAssetPayload = z.infer<typeof registerAssetPayload>;

const registerAsset: CommandDefinition<RegisterAssetPayload> = {
  name: "register-asset",
  version: 1,
  module: "ASSETS",
  allowedRoles: ["DIRECTOR", "ADMIN"],
  payloadSchema: registerAssetPayload,
  presetCode: (payload) => payload.templateCode,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) =>
      branchIdsByCode(tx, ctx, [payload.branchCode]),
  },
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
    const { branch, warnings } = await resolveTargetBranch(
      tx,
      ctx,
      envelope,
      payload.branchCode,
    );

    const customValues: Record<string, unknown> = { ...payload.customValues };
    if (payload.capacityValue !== undefined) customValues["capacityValue"] = payload.capacityValue;
    if (payload.capacityUnit !== undefined) customValues["capacityUnit"] = payload.capacityUnit;

    const templateMeta = validateCustomValues(payload.templateCode, customValues);

    const categoryRow = await tx.query.categories.findFirst({
      where: and(
        eq(categories.workspaceId, ctx.workspaceId),
        eq(categories.kind, "ASSET_CLASS"),
        eq(categories.code, payload.assetClassCode),
        eq(categories.active, true),
      ),
    });

    if (!categoryRow) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "assetClass",
        referenceCode: payload.assetClassCode,
      });
    }

    await tx.insert(assets).values({
      id: payload.assetId,
      workspaceId: ctx.workspaceId,
      branchId: branch.id,
      assetCode: payload.assetCode,
      assetClassCode: payload.assetClassCode,
      templateCode: payload.templateCode,
      templateVersion: templateMeta.version,
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
        templateVersion: templateMeta.version,
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
        "templateVersion",
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

    return { recordId: payload.assetId, rowVersion: 1, warnings };
  },
};

registerCommand(registerAsset);
