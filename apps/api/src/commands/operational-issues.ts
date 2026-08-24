import {
  dismissIssuePayload,
  reportIssuePayload,
  resolveIssuePayload,
  type CommandEnvelope,
  type CommandWarningCode,
  type DismissIssuePayload,
  type ReportIssuePayload,
  type ResolveIssuePayload,
} from "@routiq/contracts";
import { and, eq, isNull } from "drizzle-orm";
import {
  assets,
  availabilityIntervals,
  branches,
  categories,
  operationalIssues,
} from "../db/schema.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type Tx,
} from "./dispatcher.js";
import { nextIssueNumber } from "./numbering.js";

/** The asset's open downtime interval, if any — one at most (partial unique index). */
export async function openAvailabilityInterval(
  tx: Tx,
  ctx: CommandContext,
  assetId: string,
) {
  const [interval] = await tx
    .select()
    .from(availabilityIntervals)
    .where(
      and(
        eq(availabilityIntervals.workspaceId, ctx.workspaceId),
        eq(availabilityIntervals.assetId, assetId),
        isNull(availabilityIntervals.endedAt),
      ),
    )
    .limit(1);
  return interval;
}

async function selectOpenIssue(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  issueId: string,
  to: "RESOLVED" | "DISMISSED",
) {
  const [issue] = await tx
    .select()
    .from(operationalIssues)
    .where(
      and(
        eq(operationalIssues.workspaceId, ctx.workspaceId),
        eq(operationalIssues.id, issueId),
      ),
    )
    .for("update");

  if (!issue) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "operationalIssue",
      referenceId: issueId,
    });
  }

  checkOptimisticVersion(envelope, issue.rowVersion);

  if (issue.status !== "OPEN") {
    throw new CommandError(409, "INVALID_STATE_TRANSITION", {
      from: issue.status,
      to,
    });
  }

  return issue;
}

async function resolveIssueBranchIds(
  tx: Tx,
  ctx: CommandContext,
  payload: { issueId: string },
): Promise<string[]> {
  const [issue] = await tx
    .select({ branchId: operationalIssues.branchId })
    .from(operationalIssues)
    .where(
      and(
        eq(operationalIssues.workspaceId, ctx.workspaceId),
        eq(operationalIssues.id, payload.issueId),
      ),
    );
  return issue ? [issue.branchId] : [];
}

/**
 * The uncoupling warning (#28): closing an issue never touches the downtime
 * interval it opened — release-to-service is its own decision. The close
 * commits either way; this is how the receipt says the asset is still parked.
 */
async function stillUnavailableWarning(
  tx: Tx,
  ctx: CommandContext,
  issue: { id: string; assetId: string },
): Promise<CommandWarningCode[]> {
  const interval = await openAvailabilityInterval(tx, ctx, issue.assetId);
  return interval?.openedByIssueId === issue.id
    ? ["ISSUE_CLOSED_ASSET_STILL_UNAVAILABLE"]
    : [];
}

registerCommand<ReportIssuePayload>({
  name: "report-issue",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["FIELD_SUBMITTER", "MAINTENANCE", "OPS_MANAGER", "ADMIN"],
  payloadSchema: reportIssuePayload,
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async approvalContext(tx, ctx, payload) {
    const [row] = await tx
      .select({ branchCode: branches.code })
      .from(assets)
      .innerJoin(
        branches,
        and(
          eq(branches.workspaceId, assets.workspaceId),
          eq(branches.id, assets.branchId),
        ),
      )
      .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, payload.assetId)));
    return {
      categoryCode: payload.categoryCode,
      ...(row === undefined ? {} : { branchCode: row.branchCode }),
    };
  },

  async execute(tx, ctx, envelope, payload) {
    const [asset] = await tx
      .select({
        id: assets.id,
        branchId: assets.branchId,
        branchCode: branches.code,
      })
      .from(assets)
      .innerJoin(
        branches,
        and(
          eq(branches.workspaceId, assets.workspaceId),
          eq(branches.id, assets.branchId),
        ),
      )
      .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, payload.assetId)));
    if (!asset) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "asset",
        referenceId: payload.assetId,
      });
    }

    const categoryMatches = await tx
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(
        and(
          eq(categories.workspaceId, ctx.workspaceId),
          eq(categories.code, payload.categoryCode),
          eq(categories.active, true),
        ),
      );
    const category = categoryMatches.find((candidate) => candidate.kind === "ISSUE_TYPE");
    if (!category) {
      if (categoryMatches.length > 0) {
        throw new CommandError(422, "CATEGORY_KIND_MISMATCH", {
          categoryCode: payload.categoryCode,
          expectedKind: "ISSUE_TYPE",
        });
      }
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "issueCategory",
        referenceCode: payload.categoryCode,
      });
    }

    const createdAt = new Date();
    const reportedAt = payload.reportedAt ? new Date(payload.reportedAt) : createdAt;
    const branch = { id: asset.branchId, code: asset.branchCode };
    const issueNumber = await nextIssueNumber(tx, ctx, branch, reportedAt);
    const warnings: CommandWarningCode[] = [];

    await tx.insert(operationalIssues).values({
      id: payload.issueId,
      workspaceId: ctx.workspaceId,
      branchId: asset.branchId,
      issueNumber,
      assetId: payload.assetId,
      categoryId: category.id,
      ...(payload.description === undefined ? {} : { description: payload.description }),
      safetyCritical: payload.safetyCritical,
      status: "OPEN",
      reportedAt,
      createdByCommandId: envelope.commandId,
      createdAt,
    });

    /*
     * §3.4 inv. 8: a CONFIRMED safety-critical report parks the asset in the
     * same transaction. If a previous report already holds it parked, don't
     * stack a second interval — the warning tells the reporter the asset was
     * already off the road. A concurrent race lands on the partial unique
     * index instead of producing two open intervals.
     */
    let intervalId: string | undefined;
    if (payload.safetyCritical) {
      const open = await openAvailabilityInterval(tx, ctx, payload.assetId);
      if (open) {
        warnings.push("ASSET_ALREADY_UNAVAILABLE");
      } else {
        intervalId = crypto.randomUUID();
        await tx.insert(availabilityIntervals).values({
          id: intervalId,
          workspaceId: ctx.workspaceId,
          assetId: payload.assetId,
          reason: "SAFETY_CRITICAL_ISSUE",
          openedByIssueId: payload.issueId,
          startedAt: reportedAt,
          createdByCommandId: envelope.commandId,
          createdAt,
        });
      }
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "operational_issue.reported",
      entityType: "operational_issue",
      entityId: payload.issueId,
      afterState: {
        id: payload.issueId,
        workspaceId: ctx.workspaceId,
        branchId: asset.branchId,
        issueNumber,
        assetId: payload.assetId,
        categoryId: category.id,
        description: payload.description ?? null,
        safetyCritical: payload.safetyCritical,
        status: "OPEN",
        reportedAt: reportedAt.toISOString(),
        rowVersion: 1,
        createdByCommandId: envelope.commandId,
        createdAt: createdAt.toISOString(),
      },
      changedFields: [
        "id",
        "workspaceId",
        "branchId",
        "issueNumber",
        "assetId",
        "categoryId",
        "description",
        "safetyCritical",
        "status",
        "reportedAt",
        "rowVersion",
        "createdByCommandId",
        "createdAt",
      ],
    });

    if (intervalId !== undefined) {
      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "availability_interval.opened",
        entityType: "availability_interval",
        entityId: intervalId,
        afterState: {
          id: intervalId,
          workspaceId: ctx.workspaceId,
          assetId: payload.assetId,
          reason: "SAFETY_CRITICAL_ISSUE",
          openedByIssueId: payload.issueId,
          startedAt: reportedAt.toISOString(),
          endedAt: null,
          rowVersion: 1,
          createdByCommandId: envelope.commandId,
          createdAt: createdAt.toISOString(),
        },
        changedFields: [
          "id",
          "workspaceId",
          "assetId",
          "reason",
          "openedByIssueId",
          "startedAt",
          "endedAt",
          "rowVersion",
          "createdByCommandId",
          "createdAt",
        ],
      });
    }

    return {
      recordId: payload.issueId,
      rowVersion: 1,
      recordStatus: "OPEN",
      warnings,
    };
  },
});

registerCommand<ResolveIssuePayload>({
  name: "resolve-issue",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["FIELD_SUBMITTER", "MAINTENANCE", "OPS_MANAGER", "ADMIN"],
  payloadSchema: resolveIssuePayload,
  branchAuthorization: {
    kind: "branches",
    resolve: resolveIssueBranchIds,
  },

  async execute(tx, ctx, envelope, payload) {
    const issue = await selectOpenIssue(tx, ctx, envelope, payload.issueId, "RESOLVED");
    const resolvedAt = new Date();
    const rowVersion = issue.rowVersion + 1;

    await tx
      .update(operationalIssues)
      .set({
        status: "RESOLVED",
        resolvedAt,
        resolutionNote: payload.note ?? null,
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
        status: "OPEN",
        resolvedAt: null,
        resolutionNote: null,
        rowVersion: issue.rowVersion,
      },
      afterState: {
        status: "RESOLVED",
        resolvedAt: resolvedAt.toISOString(),
        resolutionNote: payload.note ?? null,
        rowVersion,
      },
      changedFields: ["status", "resolvedAt", "resolutionNote", "rowVersion"],
    });

    return {
      recordId: issue.id,
      rowVersion,
      recordStatus: "RESOLVED",
      warnings: await stillUnavailableWarning(tx, ctx, issue),
    };
  },
});

registerCommand<DismissIssuePayload>({
  name: "dismiss-issue",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["MAINTENANCE", "OPS_MANAGER", "ADMIN"],
  payloadSchema: dismissIssuePayload,
  branchAuthorization: {
    kind: "branches",
    resolve: resolveIssueBranchIds,
  },

  async execute(tx, ctx, envelope, payload) {
    const issue = await selectOpenIssue(tx, ctx, envelope, payload.issueId, "DISMISSED");
    const rowVersion = issue.rowVersion + 1;

    await tx
      .update(operationalIssues)
      .set({
        status: "DISMISSED",
        dismissedReason: payload.reason,
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
        status: "OPEN",
        dismissedReason: null,
        rowVersion: issue.rowVersion,
      },
      afterState: {
        status: "DISMISSED",
        dismissedReason: payload.reason,
        rowVersion,
      },
      changedFields: ["status", "dismissedReason", "rowVersion"],
    });

    return {
      recordId: issue.id,
      rowVersion,
      recordStatus: "DISMISSED",
      warnings: await stillUnavailableWarning(tx, ctx, issue),
    };
  },
});
