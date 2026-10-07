import {
  registerAssetPayload,
  registerAssetV1Payload,
  type RegisterAssetPayload,
  type RegisterAssetV1Payload,
} from "@routiq/contracts";
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
import { assertPlateFree } from "./asset-identity.js";

/**
 * What both versions share. v2 differs only in its payload schema and in the
 * duplicate-plate check (#122), passed in as `checkPlate`.
 */
function registerAssetDefinition<P extends RegisterAssetV1Payload>(
  version: 1 | 2,
  payloadSchema: CommandDefinition<P>["payloadSchema"],
  checkPlate: boolean,
): CommandDefinition<P> {
  return {
    name: "register-asset",
    version,
    module: "ASSETS",
    allowedRoles: ["DIRECTOR", "ADMIN"],
    payloadSchema,
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

      if (checkPlate && payload.registrationNumber !== undefined) {
        await assertPlateFree(tx, ctx, payload.registrationNumber);
      }

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
}

registerCommand(registerAssetDefinition<RegisterAssetPayload>(2, registerAssetPayload, true));

/**
 * v1, kept working as shipped (AGENTS.md: a shipped payload never changes). It
 * still takes a chassis number up to 60 characters and a plate another vehicle
 * carries; the Details edit re-checks neither unless that field is changed.
 */
registerCommand(registerAssetDefinition<RegisterAssetV1Payload>(1, registerAssetV1Payload, false));
