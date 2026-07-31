import {
  recordHaulageJobSheetPayload,
  recordJourneySheetPayload,
} from "@routiq/contracts";
import type { z } from "zod";
import { assetBranchIds, branchIdsByCode } from "./branch-authorization.js";
import { registerCommand, type CommandDefinition } from "./dispatcher.js";
import { writeSheet, type SheetWrite } from "./sheet-writer.js";

type JourneyPayload = z.infer<typeof recordJourneySheetPayload>;
type HaulagePayload = z.infer<typeof recordHaulageJobSheetPayload>;
type SheetPayload = JourneyPayload | HaulagePayload;

interface SheetCommandConfig<P extends SheetPayload> {
  name: string;
  templateCode: "TRUCKING" | "PASSENGER_TRANSPORT";
  payloadSchema: z.ZodType<P>;
  /** Flavour-specific fields land in custom_values (§3.3), not in new columns. */
  flavourValues(payload: P): Record<string, unknown>;
}

/**
 * Mirrors the accepted financialEntryCommand(config) precedent. The config is
 * closed and tiny on purpose: name, template, schema, and a mapper for the
 * fields that differ. Anything that grew here would be the configuration engine
 * decision #1 refuses to build.
 */
function sheetCommand<P extends SheetPayload>(
  config: SheetCommandConfig<P>,
): CommandDefinition<P> {
  return {
    name: config.name,
    version: 1,
    module: "ACTIVITIES",
    allowedRoles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"],
    payloadSchema: config.payloadSchema,

    /** A sheet IS its preset — the template is the command, not a payload field. */
    presetCode: () => config.templateCode,

    branchAuthorization: {
      kind: "branches",
      async resolve(tx, ctx, payload) {
        const assetIds = [
          payload.primaryAssetId,
          ...payload.extraSegments.map((segment) => segment.assetId),
        ];
        const [sheetBranch, assetBranches] = await Promise.all([
          branchIdsByCode(tx, ctx, [payload.branchCode]),
          assetBranchIds(tx, ctx, assetIds),
        ]);
        return [...new Set([...sheetBranch, ...assetBranches])];
      },
    },

    /**
     * Branch only — never an amount. A sheet has no single amount, and any value
     * here would collide with the per-entry thresholds the writer evaluates.
     */
    async approvalContext(_tx, _ctx, payload) {
      return { branchCode: payload.branchCode, categoryCode: payload.activityTypeCode };
    },

    async execute(tx, ctx, envelope, payload) {
      const write: SheetWrite = {
        activityId: payload.activityId,
        branchCode: payload.branchCode,
        activityTypeCode: payload.activityTypeCode,
        templateCode: config.templateCode,
        primarySegmentId: payload.primarySegmentId,
        primaryAssetId: payload.primaryAssetId,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
        startReading: payload.startReading,
        endReading: payload.endReading,
        crew: payload.crew,
        legs: payload.legs,
        extraSegments: payload.extraSegments,
        entries: payload.entries,
        customerName: payload.customerName,
        clientReference: payload.clientReference,
        description: payload.description,
        customValues: { ...payload.customValues, ...config.flavourValues(payload) },
        close: payload.close,
      };

      const result = await writeSheet(tx, ctx, envelope, write);

      return {
        recordId: result.activityId,
        rowVersion: result.rowVersion,
        // A closed sheet reports its verdict; an open one has none to report.
        recordStatus: result.completeness ?? result.status,
        warnings: result.warnings,
        children: result.children,
      };
    },
  };
}

registerCommand(
  sheetCommand<JourneyPayload>({
    name: "record-journey-sheet",
    templateCode: "PASSENGER_TRANSPORT",
    payloadSchema: recordJourneySheetPayload,
    flavourValues: (payload) => ({
      ...(payload.seatsSold === undefined ? {} : { seatsSold: payload.seatsSold }),
      ...(payload.seatsAvailable === undefined
        ? {}
        : { seatsAvailable: payload.seatsAvailable }),
    }),
  }),
);

registerCommand(
  sheetCommand<HaulagePayload>({
    name: "record-haulage-job-sheet",
    templateCode: "TRUCKING",
    payloadSchema: recordHaulageJobSheetPayload,
    flavourValues: (payload) => ({
      ...(payload.cargoDescription === undefined
        ? {}
        : { cargoDescription: payload.cargoDescription }),
      ...(payload.cargoWeightKg === undefined
        ? {}
        : { cargoWeightKg: payload.cargoWeightKg }),
    }),
  }),
);
