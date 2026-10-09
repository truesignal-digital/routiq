import { createActivityPayload } from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  categories,
  meterReadings,
  persons,
} from "../db/schema.js";
import {
  assetBranchIds,
  branchIdsByCode,
  resolveTargetBranch,
} from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";
import { nextActivityNumber } from "./numbering.js";
import { validateCustomValues } from "./templates.js";

type CreateActivityPayload = z.infer<typeof createActivityPayload>;

/** An active ACTIVITY_TYPE category by code, or REFERENCE_NOT_FOUND. Shared with plan-trip. */
export async function resolveActivityType(
  tx: Tx,
  ctx: CommandContext,
  activityTypeCode: string,
): Promise<{ id: string }> {
  const [activityType] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, ctx.workspaceId),
        eq(categories.kind, "ACTIVITY_TYPE"),
        eq(categories.code, activityTypeCode),
        eq(categories.active, true),
      ),
    )
    .limit(1);
  if (!activityType) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "activityType",
      referenceCode: activityTypeCode,
    });
  }
  return activityType;
}

const createActivity: CommandDefinition<CreateActivityPayload> = {
  name: "create-activity",
  version: 1,
  module: "ACTIVITIES",
  allowedRoles: ["DIRECTOR", "ADMIN", "DRIVER"],
  payloadSchema: createActivityPayload,

  /** The dispatcher rejects SOLD/RETIRED/WRITTEN_OFF before the handler runs. */
  operationalAssetId: (payload) => payload.primaryAssetId,

  presetCode: (payload) => payload.templateCode,

  branchAuthorization: {
    kind: "branches",
    async resolve(tx, ctx, payload) {
      const [activityBranch, assetBranches] = await Promise.all([
        branchIdsByCode(tx, ctx, [payload.branchCode]),
        assetBranchIds(tx, ctx, [payload.primaryAssetId]),
      ]);
      return [...new Set([...activityBranch, ...assetBranches])];
    },
  },

  async approvalContext(_tx, _ctx, payload) {
    return { branchCode: payload.branchCode, categoryCode: payload.activityTypeCode };
  },

  async execute(tx, ctx, envelope, payload) {
    const { branch, warnings } = await resolveTargetBranch(
      tx,
      ctx,
      envelope,
      payload.branchCode,
    );

    const activityType = await resolveActivityType(tx, ctx, payload.activityTypeCode);

    const templateMeta = validateCustomValues(payload.templateCode, payload.customValues, "activity");

    const crewPersonIds = [...new Set(payload.crew.map((member) => member.personId))];
    if (crewPersonIds.length > 0) {
      const known = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(eq(persons.workspaceId, ctx.workspaceId), inArray(persons.id, crewPersonIds)),
        );
      const knownIds = new Set(known.map((row) => row.id));
      const missing = crewPersonIds.filter((id) => !knownIds.has(id));
      if (missing.length > 0) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "person",
          missing,
        });
      }
    }

    const startedAt = new Date(payload.startedAt);
    const activityNumber = await nextActivityNumber(
      tx,
      ctx,
      branch,
      payload.startedAt.slice(0, 10),
    );

    await tx.insert(activities).values({
      id: payload.activityId,
      workspaceId: ctx.workspaceId,
      branchId: branch.id,
      activityNumber,
      activityTypeId: activityType.id,
      templateCode: payload.templateCode,
      templateVersion: templateMeta.version,
      customValues: payload.customValues,
      startedAt,
      ...(payload.plannedEndAt === undefined
        ? {}
        : { plannedEndAt: new Date(payload.plannedEndAt) }),
      ...(payload.customerName === undefined ? {} : { customerName: payload.customerName }),
      ...(payload.clientReference === undefined
        ? {}
        : { clientReference: payload.clientReference }),
      ...(payload.description === undefined ? {} : { description: payload.description }),
      createdByCommandId: envelope.commandId,
    });

    // The reading must exist before the segment references it.
    if (payload.startReading) {
      await tx.insert(meterReadings).values({
        id: payload.startReading.readingId,
        workspaceId: ctx.workspaceId,
        assetId: payload.primaryAssetId,
        readingType: payload.startReading.readingType,
        value: BigInt(payload.startReading.value),
        observedAt: new Date(payload.startReading.observedAt),
        source: "ACTIVITY_START",
        activityId: payload.activityId,
        createdByCommandId: envelope.commandId,
      });
    }

    await tx.insert(activityAssetSegments).values({
      id: payload.primarySegmentId,
      workspaceId: ctx.workspaceId,
      activityId: payload.activityId,
      assetId: payload.primaryAssetId,
      role: "PRIMARY",
      startedAt,
      ...(payload.startReading === undefined
        ? {}
        : { startReadingId: payload.startReading.readingId }),
      createdByCommandId: envelope.commandId,
    });

    if (payload.crew.length > 0) {
      await tx.insert(activityPeople).values(
        payload.crew.map((member) => ({
          id: member.activityPersonId,
          workspaceId: ctx.workspaceId,
          activityId: payload.activityId,
          personId: member.personId,
          role: member.role,
          createdByCommandId: envelope.commandId,
        })),
      );
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "activity.created",
      entityType: "activity",
      entityId: payload.activityId,
      afterState: {
        id: payload.activityId,
        workspaceId: ctx.workspaceId,
        branchId: branch.id,
        activityNumber,
        activityTypeId: activityType.id,
        activityTypeCode: payload.activityTypeCode,
        templateCode: payload.templateCode,
        templateVersion: templateMeta.version,
        customValues: payload.customValues,
        status: "OPEN",
        completeness: null,
        completenessCodes: [],
        customerName: payload.customerName ?? null,
        clientReference: payload.clientReference ?? null,
        description: payload.description ?? null,
        startedAt: startedAt.toISOString(),
        plannedEndAt: payload.plannedEndAt ?? null,
        endedAt: null,
        rowVersion: 1,
        segments: [
          {
            id: payload.primarySegmentId,
            assetId: payload.primaryAssetId,
            role: "PRIMARY",
            startedAt: startedAt.toISOString(),
            endedAt: null,
            startReadingId: payload.startReading?.readingId ?? null,
          },
        ],
        crew: payload.crew,
      },
      changedFields: [
        "id",
        "workspaceId",
        "branchId",
        "activityNumber",
        "activityTypeId",
        "templateCode",
        "templateVersion",
        "customValues",
        "status",
        "completeness",
        "completenessCodes",
        "customerName",
        "clientReference",
        "description",
        "startedAt",
        "plannedEndAt",
        "endedAt",
        "rowVersion",
        "segments",
        "crew",
      ],
    });

    return { recordId: payload.activityId, rowVersion: 1, recordStatus: "OPEN", warnings };
  },
};

registerCommand(createActivity);
