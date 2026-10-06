import {
  canReadLedger,
  plateKey,
  TEMPLATE_FIELDS,
  updateAssetDetailsPayload,
  type TemplateCode,
  type UpdateAssetDetailsPayload,
} from "@routiq/contracts";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { assets, workspaces } from "../db/schema.js";
import { isModuleEnabled } from "../modules/registry.js";
import { currentBusinessDate } from "../reads/business-date.js";
import { assertPlateFree } from "./asset-identity.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { validateCustomValues } from "./templates.js";
import { updateAssetAtVersion, type AssetVersionedChanges } from "./versioned-write.js";

type AssetRow = typeof assets.$inferSelect;

/** The descriptive snapshot the audit event keeps, before and after. */
function detailsState(row: AssetRow): Record<string, unknown> {
  return {
    registrationNumber: row.registrationNumber,
    manufacturer: row.manufacturer,
    model: row.model,
    modelYear: row.modelYear,
    chassisNumber: row.chassisNumber,
    acquisitionDate: row.acquisitionDate,
    acquisitionAmountMinor:
      row.acquisitionAmountMinor === null ? null : Number(row.acquisitionAmountMinor),
    currency: row.currency,
    customValues: row.customValues,
    rowVersion: row.rowVersion,
  };
}

const COLUMN_FIELDS = [
  "registrationNumber",
  "manufacturer",
  "model",
  "modelYear",
  "chassisNumber",
  "acquisitionDate",
  "acquisitionAmountMinor",
] as const;

function validationFailed(field: string, reason: string): CommandError {
  return new CommandError(400, "VALIDATION_FAILED", {
    issues: [{ code: "custom", path: [field], reason }],
  });
}

/**
 * Level 1 of ADR-0008: a plain edit of what the vehicle is — plate, make,
 * model, year, chassis, acquisition, specifications — in place, with the
 * before and after on the audit event, which the vehicle's History reads.
 *
 * The version on screen must match (`expectedVersion` is required), so a
 * second editor gets VERSION_CONFLICT and nothing is overwritten. A disposed
 * vehicle takes no edit: `operationalAssetId` makes the dispatcher refuse it.
 *
 * The acquisition amount is money: only a role that reads the books, in a
 * workspace running the finance module, may set it — the same people who see
 * it on the card.
 */
export const updateAssetDetails: CommandDefinition<UpdateAssetDetailsPayload> = {
  name: "update-asset-details",
  version: 1,
  module: "ASSETS",
  allowedRoles: ["DIRECTOR", "ADMIN"],
  payloadSchema: updateAssetDetailsPayload,
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async execute(tx, ctx, envelope, payload) {
    const expectedVersion = envelope.expectedVersion;
    if (expectedVersion === undefined) {
      throw new CommandError(400, "EXPECTED_VERSION_REQUIRED");
    }

    const [current] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, payload.assetId)))
      .for("update");
    if (!current) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "asset",
        referenceId: payload.assetId,
      });
    }
    if (current.rowVersion !== expectedVersion) {
      throw new CommandError(409, "VERSION_CONFLICT", {
        expectedVersion,
        currentVersion: current.rowVersion,
      });
    }

    if (payload.acquisitionAmountMinor !== undefined) {
      if (!canReadLedger(ctx.role)) {
        throw new CommandError(403, "ROLE_FORBIDDEN", { field: "acquisitionAmountMinor" });
      }
      if (!(await isModuleEnabled(tx, ctx.workspaceId, "FINANCE"))) {
        throw new CommandError(403, "MODULE_DISABLED", {
          module: "FINANCE",
          field: "acquisitionAmountMinor",
        });
      }
    }

    if (payload.acquisitionDate !== undefined && payload.acquisitionDate !== null) {
      const [workspace] = await tx
        .select({ timezone: workspaces.timezone })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId));
      const today = currentBusinessDate(new Date(), workspace?.timezone ?? "Africa/Douala");
      if (payload.acquisitionDate > today) {
        throw validationFailed("acquisitionDate", "IN_FUTURE");
      }
    }

    const nextDate =
      payload.acquisitionDate === undefined ? current.acquisitionDate : payload.acquisitionDate;
    const nextAmount =
      payload.acquisitionAmountMinor === undefined
        ? current.acquisitionAmountMinor
        : payload.acquisitionAmountMinor;
    // Checked only when the call touches the acquisition: an older row that
    // already has an amount without a date must not block a plate fix.
    if (
      (payload.acquisitionDate !== undefined || payload.acquisitionAmountMinor !== undefined) &&
      nextAmount !== null &&
      nextDate === null
    ) {
      throw validationFailed("acquisitionDate", "REQUIRED_WITH_AMOUNT");
    }

    // Only a new plate is a new claim on it. The one already on the vehicle,
    // sent back as it is or re-spaced, passes even where register-asset v1
    // let a second vehicle in under it (#122).
    if (
      payload.registrationNumber !== undefined &&
      payload.registrationNumber !== null &&
      (current.registrationNumber === null ||
        plateKey(payload.registrationNumber) !== plateKey(current.registrationNumber))
    ) {
      await assertPlateFree(tx, ctx, payload.registrationNumber, current.id);
    }

    let customValues = current.customValues;
    if (payload.customValues !== undefined) {
      const known = new Set(
        (TEMPLATE_FIELDS[current.templateCode as TemplateCode] ?? []).map((field) => field.key),
      );
      const unknownKeys = Object.keys(payload.customValues).filter((key) => !known.has(key));
      if (unknownKeys.length > 0) {
        throw new CommandError(400, "TEMPLATE_FIELD_INVALID", { unknownKeys });
      }
      const merged: Record<string, unknown> = { ...current.customValues };
      for (const [key, value] of Object.entries(payload.customValues)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      validateCustomValues(current.templateCode, merged);
      customValues = merged;
    }

    const changes: AssetVersionedChanges = {};
    for (const field of COLUMN_FIELDS) {
      const value = payload[field];
      if (value === undefined) continue;
      if (field === "acquisitionAmountMinor") {
        const next = value === null ? null : BigInt(value);
        if (next !== current.acquisitionAmountMinor) changes.acquisitionAmountMinor = next;
        continue;
      }
      if (value !== current[field]) Object.assign(changes, { [field]: value });
    }
    if (!isDeepStrictEqual(customValues, current.customValues)) changes.customValues = customValues;

    // Everything asked for is already so: nothing to write, nothing to audit.
    if (Object.keys(changes).length === 0) {
      return { recordId: current.id, rowVersion: current.rowVersion };
    }

    const updated = await updateAssetAtVersion(tx, ctx, envelope, current.id, changes);

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "asset.details_updated",
      entityType: "asset",
      entityId: current.id,
      beforeState: detailsState(current),
      afterState: detailsState(updated),
      changedFields: [...Object.keys(changes), "rowVersion"],
    });

    return { recordId: updated.id, rowVersion: updated.rowVersion };
  },
};

registerCommand(updateAssetDetails);
