import {
  dismissIssuePayload,
  resolveIssuePayload,
  type CommandEnvelope,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { operationalIssues } from "../db/schema.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";
import {
  issueBranchIds,
  loadIssueForUpdate,
  type WorkOrderRow,
} from "./work-order-lookup.js";

type ResolveIssuePayload = z.infer<typeof resolveIssuePayload>;
type DismissIssuePayload = z.infer<typeof dismissIssuePayload>;

/**
 * OPEN → RESOLVED, with the note and — when a completed work order is what
 * resolved it — the order's id in the trail. Shared by resolve-issue and the
 * two completion paths, so the transition and its audit shape cannot drift.
 *
 * Release to service never comes through here (#28): availability and issue
 * state are decoupled, and a resolved issue on a grounded truck is a normal
 * state for the screen to show.
 */
export async function markIssueResolved(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  issue: typeof operationalIssues.$inferSelect,
  resolution: { note?: string | undefined; workOrderId?: string | undefined },
): Promise<number> {
  const resolvedAt = new Date();
  const rowVersion = issue.rowVersion + 1;
  await tx
    .update(operationalIssues)
    .set({
      status: "RESOLVED",
      resolvedAt,
      resolutionNote: resolution.note ?? null,
      rowVersion,
    })
    .where(
      and(
        eq(operationalIssues.workspaceId, ctx.workspaceId),
        eq(operationalIssues.id, issue.id),
      ),
    );

  await appendAuditEvent(tx, ctx, envelope, {
    eventType: "operational_issue.resolved",
    entityType: "operational_issue",
    entityId: issue.id,
    beforeState: {
      status: issue.status,
      resolvedAt: null,
      resolutionNote: null,
      rowVersion: issue.rowVersion,
    },
    afterState: {
      status: "RESOLVED",
      resolvedAt: resolvedAt.toISOString(),
      resolutionNote: resolution.note ?? null,
      resolvedByWorkOrderId: resolution.workOrderId ?? null,
      rowVersion,
    },
    changedFields: ["status", "resolvedAt", "resolutionNote", "rowVersion"],
  });
  return rowVersion;
}

/**
 * Resolves the order's signalement when the completion that asked for it takes
 * effect. An issue some other path already closed stays as it is — a second
 * work order on the same fault completing later is not a second resolution.
 */
export async function resolveLinkedIssueOnCompletion(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  workOrder: WorkOrderRow,
  note: string | null | undefined,
): Promise<void> {
  if (workOrder.issueId === null) return;
  const issue = await loadIssueForUpdate(tx, ctx, workOrder.issueId);
  if (issue.status !== "OPEN") return;
  await markIssueResolved(tx, ctx, envelope, issue, {
    note: note ?? undefined,
    workOrderId: workOrder.id,
  });
}

function requireOpen(
  issue: typeof operationalIssues.$inferSelect,
  to: "RESOLVED" | "DISMISSED",
): void {
  if (issue.status !== "OPEN") {
    throw new CommandError(409, "INVALID_STATE_TRANSITION", {
      from: issue.status,
      to,
    });
  }
}

/**
 * The fault dealt with without a work order — fixed on the spot. The workshop
 * and the branch's managers may say so; a driver reports, the technician
 * resolves (roles-and-access reference). Branch scope still applies through
 * the issue's asset.
 */
export const resolveIssue: CommandDefinition<ResolveIssuePayload> = {
  name: "resolve-issue",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "TECHNICIAN"],
  payloadSchema: resolveIssuePayload,
  branchAuthorization: { kind: "branches", resolve: issueBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const issue = await loadIssueForUpdate(tx, ctx, payload.issueId);
    checkOptimisticVersion(envelope, issue.rowVersion);
    requireOpen(issue, "RESOLVED");

    const rowVersion = await markIssueResolved(tx, ctx, envelope, issue, {
      note: payload.note,
    });
    return {
      recordId: issue.id,
      rowVersion,
      recordStatus: "RESOLVED",
      warnings: [],
    };
  },
};

/**
 * Reported in error, a duplicate, nothing found. A judgement against someone's
 * report, so the reason is required and the reporting-only role cannot make it.
 * Dismissal does not release a grounded asset either; it only makes an override
 * release possible (see release-asset-to-service).
 */
export const dismissIssue: CommandDefinition<DismissIssuePayload> = {
  name: "dismiss-issue",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "TECHNICIAN"],
  payloadSchema: dismissIssuePayload,
  branchAuthorization: { kind: "branches", resolve: issueBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const issue = await loadIssueForUpdate(tx, ctx, payload.issueId);
    checkOptimisticVersion(envelope, issue.rowVersion);
    requireOpen(issue, "DISMISSED");

    const dismissedAt = new Date();
    const rowVersion = issue.rowVersion + 1;
    await tx
      .update(operationalIssues)
      .set({
        status: "DISMISSED",
        dismissedAt,
        dismissReason: payload.reason,
        rowVersion,
      })
      .where(
        and(
          eq(operationalIssues.workspaceId, ctx.workspaceId),
          eq(operationalIssues.id, issue.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "operational_issue.dismissed",
      entityType: "operational_issue",
      entityId: issue.id,
      beforeState: {
        status: issue.status,
        dismissedAt: null,
        dismissReason: null,
        rowVersion: issue.rowVersion,
      },
      afterState: {
        status: "DISMISSED",
        dismissedAt: dismissedAt.toISOString(),
        dismissReason: payload.reason,
        rowVersion,
      },
      changedFields: ["status", "dismissedAt", "dismissReason", "rowVersion"],
    });

    return {
      recordId: issue.id,
      rowVersion,
      recordStatus: "DISMISSED",
      warnings: [],
    };
  },
};

registerCommand(resolveIssue);
registerCommand(dismissIssue);
