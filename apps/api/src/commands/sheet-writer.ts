import type {
  ActivityCrewMember,
  CommandWarningCode,
  MeterReadingCapture,
  SheetEntry,
  SheetLeg,
  SheetSegment,
} from "@routiq/contracts";
import type { CommandEnvelope } from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  assets,
  branches,
  categories,
  meterReadings,
  movementLegs,
  persons,
} from "../db/schema.js";
import { evaluateApproval } from "./approvals.js";
import { activityRequirements, evaluateCompleteness } from "./completeness.js";
import {
  appendAuditEvent,
  CommandError,
  type CommandContext,
  type CommandOutcomeChild,
  type Tx,
} from "./dispatcher.js";
import { writeFinancialEntry } from "./financial-entry-writer.js";
import { nextActivityNumber } from "./numbering.js";
import { resolveOrCreatePlace } from "./places.js";
import { validateCustomValues } from "./templates.js";

export interface SheetWrite {
  activityId: string;
  branchCode: string;
  activityTypeCode: string;
  templateCode: "TRUCKING" | "PASSENGER_TRANSPORT";
  primarySegmentId: string;
  primaryAssetId: string;
  startedAt: string;
  endedAt: string;
  startReading?: MeterReadingCapture | undefined;
  endReading?: MeterReadingCapture | undefined;
  crew: readonly ActivityCrewMember[];
  legs: readonly SheetLeg[];
  extraSegments: readonly SheetSegment[];
  entries: readonly SheetEntry[];
  customerName?: string | undefined;
  clientReference?: string | undefined;
  description?: string | undefined;
  customValues: Record<string, unknown>;
}

export interface SheetResult {
  activityId: string;
  activityNumber: string;
  completeness: "COMPLETE" | "COMPLETE_WITH_EXCEPTIONS";
  warnings: CommandWarningCode[];
  children: CommandOutcomeChild[];
}

const TERMINAL_ASSET_STATUSES = new Set(["SOLD", "RETIRED", "WRITTEN_OFF"]);

/**
 * Every asset a sheet touches must still be in the fleet. The dispatcher's
 * `operationalAssetId` hook only covers single-target commands, and a sheet
 * names a tractor, a trailer and possibly a substitute.
 */
async function assertAssetsOperational(
  tx: Tx,
  ctx: CommandContext,
  assetIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: assets.id, lifecycleStatus: assets.lifecycleStatus })
    .from(assets)
    .where(and(eq(assets.workspaceId, ctx.workspaceId), inArray(assets.id, unique)));
  const known = new Map(rows.map((row) => [row.id, row]));
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", { referenceType: "asset", missing });
  }
  const terminal = rows.find((row) => TERMINAL_ASSET_STATUSES.has(row.lifecycleStatus));
  if (terminal) {
    throw new CommandError(409, "ASSET_NOT_OPERATIONAL", {
      assetId: terminal.id,
      lifecycleStatus: terminal.lifecycleStatus,
    });
  }
}

/**
 * The whole sheet, in one transaction: activity, segments, crew, legs, readings
 * and money. One implementation for every flavour — what differs between a
 * journey and a haulage job is the payload schema and its mapper, never this.
 *
 * The activity is created AND closed here. A paper trip sheet is transcribed
 * after the trip, so the <10-minute close criterion (§5.1) means one submission
 * has to do both. The granular commands remain the path for a trip recorded live
 * or corrected afterwards.
 */
export async function writeSheet(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  write: SheetWrite,
): Promise<SheetResult> {
  const [branch] = await tx
    .select({ id: branches.id, code: branches.code })
    .from(branches)
    .where(and(eq(branches.workspaceId, ctx.workspaceId), eq(branches.code, write.branchCode)))
    .limit(1);
  if (!branch) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "branch",
      referenceCode: write.branchCode,
    });
  }

  const [activityType] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, ctx.workspaceId),
        eq(categories.kind, "ACTIVITY_TYPE"),
        eq(categories.code, write.activityTypeCode),
        eq(categories.active, true),
      ),
    )
    .limit(1);
  if (!activityType) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "activityType",
      referenceCode: write.activityTypeCode,
    });
  }

  await assertAssetsOperational(tx, ctx, [
    write.primaryAssetId,
    ...write.extraSegments.map((segment) => segment.assetId),
    ...write.entries.flatMap((entry) => (entry.assetId === undefined ? [] : [entry.assetId])),
  ]);

  const personIds = [
    ...new Set([
      ...write.crew.map((member) => member.personId),
      ...write.entries.flatMap((entry) => (entry.personId === undefined ? [] : [entry.personId])),
    ]),
  ];
  if (personIds.length > 0) {
    const known = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.workspaceId, ctx.workspaceId), inArray(persons.id, personIds)));
    const knownIds = new Set(known.map((row) => row.id));
    const missing = personIds.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "person",
        missing,
      });
    }
  }

  const templateMeta = validateCustomValues(write.templateCode, write.customValues, "activity");
  const startedAt = new Date(write.startedAt);
  const endedAt = new Date(write.endedAt);
  if (endedAt <= startedAt) {
    throw new CommandError(422, "VALIDATION_FAILED", {
      reason: "the sheet ends before it starts",
    });
  }

  // An extra segment with no end inherits the sheet's, so a trailer coupled
  // after the stated end would produce ended_at < started_at. The CHECK catches
  // it either way, but a mistyped coupling time is a clerk's error and deserves
  // a validation code rather than COMMAND_FAILED.
  for (const segment of write.extraSegments) {
    const segmentStart = new Date(segment.startedAt);
    const segmentEnd = segment.endedAt === undefined ? endedAt : new Date(segment.endedAt);
    if (segmentEnd <= segmentStart) {
      throw new CommandError(422, "VALIDATION_FAILED", {
        reason: "segment ends before it starts",
        segmentId: segment.segmentId,
        startedAt: segment.startedAt,
        endedAt: segmentEnd.toISOString(),
      });
    }
  }

  const activityNumber = await nextActivityNumber(tx, ctx, branch, write.startedAt.slice(0, 10));

  await tx.insert(activities).values({
    id: write.activityId,
    workspaceId: ctx.workspaceId,
    branchId: branch.id,
    activityNumber,
    activityTypeId: activityType.id,
    templateCode: write.templateCode,
    templateVersion: templateMeta.version,
    customValues: write.customValues,
    startedAt,
    endedAt,
    ...(write.customerName === undefined ? {} : { customerName: write.customerName }),
    ...(write.clientReference === undefined ? {} : { clientReference: write.clientReference }),
    ...(write.description === undefined ? {} : { description: write.description }),
    createdByCommandId: envelope.commandId,
  });

  // Readings before the segments that reference them.
  const readings = [
    write.startReading === undefined
      ? undefined
      : { capture: write.startReading, source: "ACTIVITY_START" as const },
    write.endReading === undefined
      ? undefined
      : { capture: write.endReading, source: "ACTIVITY_END" as const },
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  if (readings.length > 0) {
    await tx.insert(meterReadings).values(
      readings.map(({ capture, source }) => ({
        id: capture.readingId,
        workspaceId: ctx.workspaceId,
        assetId: write.primaryAssetId,
        readingType: capture.readingType,
        value: BigInt(capture.value),
        observedAt: new Date(capture.observedAt),
        source,
        activityId: write.activityId,
        createdByCommandId: envelope.commandId,
      })),
    );
  }

  await tx.insert(activityAssetSegments).values([
    {
      id: write.primarySegmentId,
      workspaceId: ctx.workspaceId,
      activityId: write.activityId,
      assetId: write.primaryAssetId,
      role: "PRIMARY" as const,
      startedAt,
      endedAt,
      ...(write.startReading === undefined
        ? {}
        : { startReadingId: write.startReading.readingId }),
      ...(write.endReading === undefined ? {} : { endReadingId: write.endReading.readingId }),
      createdByCommandId: envelope.commandId,
    },
    ...write.extraSegments.map((segment) => ({
      id: segment.segmentId,
      workspaceId: ctx.workspaceId,
      activityId: write.activityId,
      assetId: segment.assetId,
      role: segment.role,
      startedAt: new Date(segment.startedAt),
      endedAt: segment.endedAt === undefined ? endedAt : new Date(segment.endedAt),
      createdByCommandId: envelope.commandId,
    })),
  ]);

  if (write.crew.length > 0) {
    await tx.insert(activityPeople).values(
      write.crew.map((member) => ({
        id: member.activityPersonId,
        workspaceId: ctx.workspaceId,
        activityId: write.activityId,
        personId: member.personId,
        role: member.role,
        createdByCommandId: envelope.commandId,
      })),
    );
  }

  for (const leg of write.legs) {
    const origin =
      leg.origin.kind === "text"
        ? { text: leg.origin.text }
        : {
            placeId: await resolveOrCreatePlace(
              tx,
              ctx,
              { placeId: leg.origin.placeId, name: leg.origin.name },
              envelope.commandId,
            ),
          };
    const destination =
      leg.destination.kind === "text"
        ? { text: leg.destination.text }
        : {
            placeId: await resolveOrCreatePlace(
              tx,
              ctx,
              { placeId: leg.destination.placeId, name: leg.destination.name },
              envelope.commandId,
            ),
          };
    await tx.insert(movementLegs).values({
      id: leg.legId,
      workspaceId: ctx.workspaceId,
      activityId: write.activityId,
      legNo: leg.legNo,
      ...(leg.segmentId === undefined ? {} : { segmentId: leg.segmentId }),
      ...("placeId" in origin ? { originPlaceId: origin.placeId } : { originText: origin.text }),
      ...("placeId" in destination
        ? { destinationPlaceId: destination.placeId }
        : { destinationText: destination.text }),
      ...(leg.departedAt === undefined ? {} : { departedAt: new Date(leg.departedAt) }),
      ...(leg.arrivedAt === undefined ? {} : { arrivedAt: new Date(leg.arrivedAt) }),
      ...(leg.distanceKm === undefined ? {} : { distanceKm: leg.distanceKm }),
      ...(leg.loadState === undefined ? {} : { loadState: leg.loadState }),
      ...(leg.passengerCount === undefined ? {} : { passengerCount: leg.passengerCount }),
      createdByCommandId: envelope.commandId,
    });
  }

  const children: CommandOutcomeChild[] = [];
  const warnings = new Set<CommandWarningCode>();
  let revenueEntryCount = 0;

  for (const entry of write.entries) {
    const commandType = entry.direction === "EXPENSE" ? "record-expense" : "record-revenue";
    // Evaluated per embedded entry under the STANDALONE command type. The
    // dispatcher decides once per command, but a sheet carries many amounts in
    // many categories — and thresholds are tenant-editable per command type, so
    // evaluating under the sheet's own name would create a second, invisible
    // threshold set for the same economic fact.
    const approval = await evaluateApproval(tx, ctx, envelope, commandType, {
      branchCode: write.branchCode,
      categoryCode: entry.categoryCode,
      amountMinor: entry.amountMinor,
    });

    const written = await writeFinancialEntry(
      tx,
      ctx,
      envelope,
      {
        entryId: entry.entryId,
        direction: entry.direction,
        categoryKind: entry.direction === "EXPENSE" ? "EXPENSE_CATEGORY" : "REVENUE_CATEGORY",
        categoryRefType:
          entry.direction === "EXPENSE" ? "expenseCategory" : "revenueCategory",
        branchCode: write.branchCode,
        categoryCode: entry.categoryCode,
        economicDate: entry.economicDate,
        amountMinor: entry.amountMinor,
        currency: "XAF",
        paymentMethod: entry.paymentMethod,
        estimateStatus: "ACTUAL",
        ...(entry.paymentReference === undefined
          ? {}
          : { paymentReference: entry.paymentReference }),
        ...(entry.description === undefined ? {} : { description: entry.description }),
        ...(entry.counterpartyName === undefined
          ? {}
          : { counterpartyName: entry.counterpartyName }),
        postings: [
          {
            amountMinor: entry.amountMinor,
            assetAttribution: "DIRECT" as const,
            activityAttribution: "DIRECT" as const,
            ...(entry.assetId === undefined ? {} : { assetId: entry.assetId }),
            ...(entry.personId === undefined ? {} : { personId: entry.personId }),
            // Opting out is how a repair to the failed asset stays off the job.
            ...(entry.attributeToActivity ? { activityId: write.activityId } : {}),
          },
        ],
      },
      approval,
    );

    for (const warning of written.warnings) warnings.add(warning);
    children.push({
      entityType: "financial_entry",
      id: written.entryId,
      status: written.status,
      warnings: written.warnings,
    });
    if (entry.direction === "REVENUE" && entry.attributeToActivity) revenueEntryCount += 1;
  }

  const segments = await tx
    .select({
      role: activityAssetSegments.role,
      endedAt: activityAssetSegments.endedAt,
      startReadingId: activityAssetSegments.startReadingId,
      endReadingId: activityAssetSegments.endReadingId,
    })
    .from(activityAssetSegments)
    .where(
      and(
        eq(activityAssetSegments.workspaceId, ctx.workspaceId),
        eq(activityAssetSegments.activityId, write.activityId),
      ),
    );

  const verdict = evaluateCompleteness({
    startedAt,
    endedAt,
    segments,
    legCount: write.legs.length,
    crewCount: write.crew.length,
    revenueEntryCount,
    requirements: activityRequirements(write.templateCode),
  });
  if (!verdict.closeable) {
    // Unreachable through a sheet — dates and the primary segment are required
    // by the schema — but the evaluator is the single source of truth and must
    // not be second-guessed here.
    throw new CommandError(422, "ACTIVITY_CLOSE_BLOCKED", { blockedBy: verdict.blockedBy });
  }
  for (const code of verdict.codes) warnings.add(code);

  await tx
    .update(activities)
    .set({
      status: "CLOSED",
      completeness: verdict.completeness,
      completenessCodes: verdict.codes,
      closedAt: new Date(),
      closedByCommandId: envelope.commandId,
      rowVersion: 2,
    })
    .where(
      and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.id, write.activityId)),
    );

  await appendAuditEvent(tx, ctx, envelope, {
    eventType: "activity.sheet_recorded",
    entityType: "activity",
    entityId: write.activityId,
    afterState: {
      id: write.activityId,
      activityNumber,
      branchId: branch.id,
      activityTypeCode: write.activityTypeCode,
      templateCode: write.templateCode,
      status: "CLOSED",
      completeness: verdict.completeness,
      completenessCodes: verdict.codes,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      customerName: write.customerName ?? null,
      clientReference: write.clientReference ?? null,
      segmentIds: [
        write.primarySegmentId,
        ...write.extraSegments.map((segment) => segment.segmentId),
      ],
      legIds: write.legs.map((leg) => leg.legId),
      crew: write.crew,
      readingIds: readings.map(({ capture }) => capture.readingId),
      entries: children,
      customValues: write.customValues,
    },
    changedFields: [
      "id",
      "activityNumber",
      "status",
      "completeness",
      "completenessCodes",
      "startedAt",
      "endedAt",
      "segmentIds",
      "legIds",
      "crew",
      "readingIds",
      "entries",
    ],
  });

  return {
    activityId: write.activityId,
    activityNumber,
    completeness: verdict.completeness,
    warnings: [...warnings],
    children,
  };
}
