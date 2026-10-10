import { reportIssuePayload } from "@routiq/contracts";
import type { z } from "zod";
import { operationalIssues } from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { nextIssueNumber } from "./numbering.js";
import { groundAssetForIssue, requireAsset } from "./work-order-lookup.js";

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
 * interval (see `groundAssetForIssue`). change-issue-severity grounds through
 * the same function when a report is marked safety-critical later (#96).
 */
export const reportIssue: CommandDefinition<ReportIssuePayload> = {
  name: "report-issue",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "TECHNICIAN", "DRIVER"],
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
    // Drawn here, at commit, even for a report captured offline: the device
    // shows "number pending" until the replay lands.
    const number = await nextIssueNumber(tx, ctx);

    await tx.insert(operationalIssues).values({
      id: payload.issueId,
      workspaceId: ctx.workspaceId,
      number,
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
        number,
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
        "number",
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
      await groundAssetForIssue(tx, ctx, envelope, {
        assetId: payload.assetId,
        issueId: payload.issueId,
        openedAt: reportedAt,
      });
    }

    return {
      recordId: payload.issueId,
      rowVersion: 1,
      warnings: [],
    };
  },
};

registerCommand(reportIssue);
