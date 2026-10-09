import { changeIssueSeverityPayload, type Role } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { assets, operationalIssues } from "../db/schema.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import {
  groundAssetForIssue,
  issueBranchIds,
  loadIssueForUpdate,
} from "./work-order-lookup.js";

type ChangeIssueSeverityPayload = z.infer<typeof changeIssueSeverityPayload>;

/**
 * Who may take the safety-critical mark off a problem (#96): the managers.
 * Everyone who reports problems may add the mark; taking it off overrules a
 * report that called the vehicle unsafe. The issue's "Administrateur /
 * Opérations" is ADMIN since ADR-0009 (OPS_MANAGER became ADMIN), and
 * DIRECTOR may do anything ADMIN may.
 */
export const SEVERITY_LOWERING_ROLES = ["DIRECTOR", "ADMIN"] as const satisfies readonly Role[];

const DISPOSED = ["SOLD", "RETIRED", "WRITTEN_OFF"];

/**
 * Marks an OPEN signalement safety-critical, or takes the mark off (#96).
 *
 * Raising is open to every role that reports problems: the reporter who forgot
 * the box, and any driver or technician in the vehicle's branches who sees the
 * danger (they could report a new safety-critical problem anyway). It grounds
 * the vehicle exactly as a safety-critical report does.
 *
 * Lowering is the managers' call and needs a reason. It never releases the
 * vehicle: availability is not the report (#28), and a release keeps its own
 * rules. The report's own columns stay as written; the trail keeps who changed
 * the mark, when, from what, to what, and why.
 */
export const changeIssueSeverity: CommandDefinition<ChangeIssueSeverityPayload> = {
  name: "change-issue-severity",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "TECHNICIAN", "DRIVER"],
  payloadSchema: changeIssueSeverityPayload,
  branchAuthorization: { kind: "branches", resolve: issueBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const raising = payload.safetyCritical;
    if (!raising && !(SEVERITY_LOWERING_ROLES as readonly Role[]).includes(ctx.role)) {
      throw new CommandError(403, "ROLE_FORBIDDEN", {
        command: "change-issue-severity",
        change: "LOWER",
      });
    }

    const issue = await loadIssueForUpdate(tx, ctx, payload.issueId);
    checkOptimisticVersion(envelope, issue.rowVersion);
    if (issue.status !== "OPEN") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: issue.status,
        to: issue.status,
      });
    }
    if (issue.safetyCritical === raising) {
      throw new CommandError(409, "ISSUE_SEVERITY_ALREADY_SET", {
        safetyCritical: issue.safetyCritical,
      });
    }

    if (raising) {
      // Grounding a vehicle that has left the fleet would be a new operational
      // record on it (§3.4); the dispatcher's guard reads assetId payloads only.
      const [asset] = await tx
        .select({ lifecycleStatus: assets.lifecycleStatus })
        .from(assets)
        .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, issue.assetId)));
      if (asset && DISPOSED.includes(asset.lifecycleStatus)) {
        throw new CommandError(409, "ASSET_NOT_OPERATIONAL", {
          assetId: issue.assetId,
          lifecycleStatus: asset.lifecycleStatus,
        });
      }
    }

    const rowVersion = issue.rowVersion + 1;
    await tx
      .update(operationalIssues)
      .set({ safetyCritical: raising, rowVersion })
      .where(
        and(
          eq(operationalIssues.workspaceId, ctx.workspaceId),
          eq(operationalIssues.id, issue.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: raising ? "operational_issue.severity_raised" : "operational_issue.severity_lowered",
      entityType: "operational_issue",
      entityId: issue.id,
      beforeState: { safetyCritical: issue.safetyCritical, rowVersion: issue.rowVersion },
      afterState: {
        safetyCritical: raising,
        reason: payload.reason ?? null,
        rowVersion,
      },
      changedFields: ["safetyCritical", "rowVersion"],
    });

    if (raising) {
      await groundAssetForIssue(tx, ctx, envelope, {
        assetId: issue.assetId,
        issueId: issue.id,
        openedAt: new Date(),
      });
    }

    return { recordId: issue.id, rowVersion, warnings: [] };
  },
};

registerCommand(changeIssueSeverity);
