import { reportIssuePayload } from "@routiq/contracts";
import type { z } from "zod";
import { assetAvailabilityIntervals, operationalIssues } from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { openAvailabilityInterval, requireAsset } from "./work-order-lookup.js";

type ReportIssuePayload = z.infer<typeof reportIssuePayload>;

/**
 * Signalement: the driver's report that something is wrong with the truck.
 *
 * A fact, so it is queueable and the server does not get to reject it — the
 * brake line was already leaking when the phone had no signal. What the report
 * decides on its own is availability: a safety-critical signalement takes the
 * asset out of service the moment it is recorded, and only
 * release-asset-to-service puts it back. Availability is not lifecycle status
 * (§3.4) — the truck is still IN_SERVICE, it is simply not available to plan on.
 *
 * A second safety-critical report on an asset already down opens no second
 * interval: the asset cannot be more unavailable than it already is, and two
 * open intervals would need two releases to undo one grounding. The partial
 * unique index says the same thing structurally.
 */
export const reportIssue: CommandDefinition<ReportIssuePayload> = {
  name: "report-issue",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE"],
  payloadSchema: reportIssuePayload,
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async execute(tx, ctx, envelope, payload) {
    await requireAsset(tx, ctx, payload.assetId);

    // Offline capture: the report is dated when the driver wrote it, not when
    // the phone found a signal.
    const reportedAt = envelope.clientOccurredAt
      ? new Date(envelope.clientOccurredAt)
      : new Date();

    await tx.insert(operationalIssues).values({
      id: payload.issueId,
      workspaceId: ctx.workspaceId,
      assetId: payload.assetId,
      description: payload.description,
      safetyCritical: payload.safetyCritical,
      ...(payload.category === undefined ? {} : { category: payload.category }),
      reportedAt,
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "operational_issue.reported",
      entityType: "operational_issue",
      entityId: payload.issueId,
      afterState: {
        id: payload.issueId,
        assetId: payload.assetId,
        description: payload.description,
        safetyCritical: payload.safetyCritical,
        category: payload.category ?? null,
        reportedAt: reportedAt.toISOString(),
        status: "OPEN",
        rowVersion: 1,
      },
      changedFields: [
        "id",
        "assetId",
        "description",
        "safetyCritical",
        "category",
        "reportedAt",
        "status",
        "rowVersion",
      ],
    });

    if (payload.safetyCritical) {
      const alreadyDown = await openAvailabilityInterval(
        tx,
        ctx,
        payload.assetId,
        { forUpdate: true },
      );
      if (!alreadyDown) {
        const intervalId = crypto.randomUUID();
        const [opened] = await tx
          .insert(assetAvailabilityIntervals)
          .values({
            id: intervalId,
            workspaceId: ctx.workspaceId,
            assetId: payload.assetId,
            openedAt: reportedAt,
            openedByIssueId: payload.issueId,
            createdByCommandId: envelope.commandId,
          })
          // Backstop for two clerks recording the same breakdown at once: the
          // partial unique index decides, and the loser still records its
          // signalement rather than failing the whole report.
          .onConflictDoNothing()
          .returning({ id: assetAvailabilityIntervals.id });

        if (opened) {
          await appendAuditEvent(tx, ctx, envelope, {
            eventType: "asset_availability.opened",
            entityType: "asset_availability_interval",
            entityId: opened.id,
            afterState: {
              id: opened.id,
              assetId: payload.assetId,
              openedAt: reportedAt.toISOString(),
              openedByIssueId: payload.issueId,
              closedAt: null,
              rowVersion: 1,
            },
            changedFields: [
              "id",
              "assetId",
              "openedAt",
              "openedByIssueId",
              "closedAt",
              "rowVersion",
            ],
          });
        }
      }
    }

    return {
      recordId: payload.issueId,
      rowVersion: 1,
      warnings: [],
    };
  },
};

registerCommand(reportIssue);
