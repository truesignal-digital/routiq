import {
  cancelWorkOrderPayload,
  completeWorkOrderPayload,
  completeWorkOrderV1Payload,
  createWorkOrderPayload,
  type CommandEnvelope,
  type CommandWarningCode,
  type CompleteWorkOrderPayload,
  type CompleteWorkOrderV1Payload,
  type CompletionCostLine,
  type WorkOrderCostOutcome,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { assets, branches, operationalIssues, workOrders } from "../db/schema.js";
import { isModuleEnabled } from "../modules/registry.js";
import { evaluateApproval, type ApprovalDecision } from "./approvals.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type CommandExecuteResult,
  type CommandOutcomeChild,
  type Tx,
} from "./dispatcher.js";
import { writeFinancialEntry } from "./financial-entry-writer.js";
import { resolveLinkedIssueOnCompletion } from "./issue-decisions.js";
import { nextWorkOrderNumber } from "./numbering.js";
import {
  loadWorkOrderForUpdate,
  requireAsset,
  workOrderAssetBranchId,
  workOrderBranchIds,
  workOrderLedgerTotal,
  type WorkOrderRow,
} from "./work-order-lookup.js";

type CreateWorkOrderPayload = z.infer<typeof createWorkOrderPayload>;
type CancelWorkOrderPayload = z.infer<typeof cancelWorkOrderPayload>;

/**
 * Ordre de travail: the job the workshop is being asked to do.
 *
 * No DRAFT (#28): the approval rule is read against the EXPECTED cost and the
 * order lands APPROVED — open work, costs may attach — or SUBMITTED for
 * approve-work-order / reject-work-order. With the catalog defaults, which carry
 * no amount bounds, every authorized role's creation lands APPROVED, so a
 * workspace that never configures a threshold never meets a pending order.
 * The asset's branch goes into the rule context, so a branch-scoped threshold
 * matches (#47 finding 5).
 */
export const createWorkOrder: CommandDefinition<CreateWorkOrderPayload> = {
  name: "create-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "TECHNICIAN"],
  payloadSchema: createWorkOrderPayload,
  approvalMode: "SUBMIT",
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  async approvalContext(tx, ctx, payload) {
    const [branchId] = await assetBranchIds(tx, ctx, [payload.assetId]);
    return {
      ...(branchId === undefined ? {} : { branchId }),
      amountMinor: payload.expectedCostMinor,
    };
  },

  async execute(tx, ctx, envelope, payload, approval) {
    await requireAsset(tx, ctx, payload.assetId);

    if (payload.issueId !== undefined) {
      const [issue] = await tx
        .select({ id: operationalIssues.id, assetId: operationalIssues.assetId })
        .from(operationalIssues)
        .where(
          and(
            eq(operationalIssues.workspaceId, ctx.workspaceId),
            eq(operationalIssues.id, payload.issueId),
          ),
        )
        .limit(1);

      if (!issue) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "operationalIssue",
          referenceId: payload.issueId,
        });
      }
      // The composite tenant FK already keeps both rows in one workspace. That
      // the signalement was reported against THIS truck is a rule only the
      // command layer can hold — and it is the one the release reads to decide
      // which completed work answers a grounding.
      if (issue.assetId !== payload.assetId) {
        throw new CommandError(422, "ISSUE_ASSET_MISMATCH", {
          issueId: payload.issueId,
          issueAssetId: issue.assetId,
          assetId: payload.assetId,
        });
      }
    }

    const status = approval.outcome === "AUTO_APPROVED" ? "APPROVED" : "SUBMITTED";
    const number = await nextWorkOrderNumber(tx, ctx);

    await tx.insert(workOrders).values({
      id: payload.workOrderId,
      workspaceId: ctx.workspaceId,
      number,
      assetId: payload.assetId,
      ...(payload.issueId === undefined ? {} : { issueId: payload.issueId }),
      description: payload.description,
      status,
      expectedCostMinor: BigInt(payload.expectedCostMinor),
      currency: payload.currency,
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: status === "APPROVED" ? "work_order.created" : "work_order.submitted",
      entityType: "work_order",
      entityId: payload.workOrderId,
      afterState: {
        id: payload.workOrderId,
        number,
        assetId: payload.assetId,
        issueId: payload.issueId ?? null,
        description: payload.description,
        status,
        expectedCostMinor: payload.expectedCostMinor,
        currency: payload.currency,
        rowVersion: 1,
      },
      changedFields: [
        "id",
        "number",
        "assetId",
        "issueId",
        "description",
        "status",
        "expectedCostMinor",
        "currency",
        "rowVersion",
      ],
    });

    return {
      recordId: payload.workOrderId,
      rowVersion: 1,
      recordStatus: status,
      warnings: [],
    };
  },
};

/**
 * What a completion writes, whichever version asked for it. v1 carries a typed
 * amount and no outcome; v2 carries an outcome and the lines themselves.
 */
interface CompletionRequest {
  workOrderId: string;
  summary?: string | undefined;
  resolveLinkedIssue?: boolean | undefined;
  /** Null only for v1, which never said. */
  costOutcome: WorkOrderCostOutcome | null;
  costLines: readonly CompletionCostLine[];
  /** v1's typed amount, kept as a declaration; null for v2. */
  declaredCostMinor: bigint | null;
}

/** The order's truck branch, which is where its cost lines are booked. */
async function workOrderBranch(
  tx: Tx,
  ctx: CommandContext,
  assetId: string,
): Promise<{ id: string; code: string }> {
  const [row] = await tx
    .select({ id: branches.id, code: branches.code })
    .from(assets)
    .innerJoin(
      branches,
      and(eq(branches.workspaceId, assets.workspaceId), eq(branches.id, assets.branchId)),
    )
    .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, assetId)))
    .limit(1);
  if (!row) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "asset",
      referenceId: assetId,
    });
  }
  return row;
}

/**
 * A line's photos are the envelope's files, and the envelope's files are the
 * lines' photos: the dispatcher links and workspace-checks the envelope's set,
 * while the payload says which line each belongs to. The two must agree, as
 * attach-evidence requires of its own pair.
 */
function assertEvidenceMatchesEnvelope(
  envelope: CommandEnvelope,
  lines: readonly CompletionCostLine[],
): void {
  const claimed = lines.flatMap((line) => line.evidenceArtifactIds ?? []);
  const linked = new Set(envelope.sourceArtifactIds);
  if (claimed.length !== linked.size || claimed.some((id) => !linked.has(id))) {
    throw new CommandError(400, "VALIDATION_FAILED", {
      issues: [{ code: "custom", path: ["costLines", "evidenceArtifactIds"] }],
    });
  }
}

/**
 * Closing is where money is declared (#81). Every cost line goes through the
 * same writer as record-expense — charged to the truck and the order, booked to
 * the truck's branch, each judged by record-expense's own approval rules —
 * BEFORE the order leaves APPROVED, which is the only state costs may attach
 * to. Then the order completes. One transaction: a line that fails rolls the
 * close back with it, and a close that fails leaves no line behind.
 */
async function executeCompletion(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  request: CompletionRequest,
  approval: ApprovalDecision,
): Promise<CommandExecuteResult> {
  const workOrder = await loadWorkOrderForUpdate(tx, ctx, request.workOrderId);
  checkOptimisticVersion(envelope, workOrder.rowVersion);

  const status =
    approval.outcome === "AUTO_APPROVED" ? "COMPLETED" : "COMPLETION_SUBMITTED";

  if (workOrder.status !== "APPROVED") {
    throw new CommandError(409, "INVALID_STATE_TRANSITION", {
      from: workOrder.status,
      to: status,
    });
  }

  const children: CommandOutcomeChild[] = [];
  const warnings = new Set<CommandWarningCode>();

  if (request.costOutcome !== null) {
    assertEvidenceMatchesEnvelope(envelope, request.costLines);
    const recorded = await workOrderLedgerTotal(tx, ctx, workOrder.id);
    if (
      request.costOutcome === "LINES" &&
      request.costLines.length === 0 &&
      recorded === 0n
    ) {
      throw new CommandError(422, "WORK_ORDER_COST_MISSING", { workOrderId: workOrder.id });
    }
    if (request.costOutcome === "NO_COST" && recorded !== 0n) {
      throw new CommandError(409, "WORK_ORDER_HAS_COSTS", {
        workOrderId: workOrder.id,
        recordedCostMinor: Number(recorded),
      });
    }
  }

  if (request.costLines.length > 0) {
    // The order belongs to MAINTENANCE, its lines to FINANCE: a workspace with
    // the books switched off has nowhere to put them.
    if (!(await isModuleEnabled(tx, ctx.workspaceId, "FINANCE"))) {
      throw new CommandError(403, "MODULE_DISABLED", { module: "FINANCE" });
    }
    const branch = await workOrderBranch(tx, ctx, workOrder.assetId);
    for (const line of request.costLines) {
      // Evaluated per line under the STANDALONE command type, as the sheets do:
      // thresholds are tenant-editable per command type, and a second,
      // invisible set for the same expense would be a trap.
      const lineApproval = await evaluateApproval(tx, ctx, envelope, "record-expense", {
        branchId: branch.id,
        categoryCode: line.categoryCode,
        amountMinor: line.amountMinor,
      });
      const written = await writeFinancialEntry(
        tx,
        ctx,
        envelope,
        {
          entryId: line.entryId,
          direction: "EXPENSE",
          categoryKind: "EXPENSE_CATEGORY",
          categoryRefType: "expenseCategory",
          branchCode: branch.code,
          categoryCode: line.categoryCode,
          economicDate: line.economicDate,
          // Finance reads the entry without the order beside it (#87): the
          // repair's own description says what the money paid for.
          description: line.note ?? workOrder.description.slice(0, 500),
          amountMinor: line.amountMinor,
          currency: "XAF",
          paymentMethod: line.paymentMethod,
          estimateStatus: "ACTUAL",
          postings: [
            {
              assetId: workOrder.assetId,
              workOrderId: workOrder.id,
              amountMinor: line.amountMinor,
              assetAttribution: "DIRECT",
            },
          ],
        },
        lineApproval,
      );
      for (const warning of written.warnings) warnings.add(warning);
      children.push({
        entityType: "financial_entry",
        id: written.entryId,
        status: written.status,
        warnings: written.warnings,
      });
    }
  }

  const resolveLinkedIssue =
    workOrder.issueId !== null && (request.resolveLinkedIssue ?? true);
  const completedAt = new Date();
  const rowVersion = workOrder.rowVersion + 1;

  await tx
    .update(workOrders)
    .set({
      status,
      // `currency` is deliberately left alone: currencyCode is a literal, so
      // the payload can only ever repeat what the order was created with.
      declaredCostMinor: request.declaredCostMinor,
      costOutcome: request.costOutcome,
      summary: request.summary ?? null,
      resolveLinkedIssue,
      completionRejectReason: null,
      completedAt,
      rowVersion,
    })
    .where(
      and(
        eq(workOrders.workspaceId, ctx.workspaceId),
        eq(workOrders.id, workOrder.id),
      ),
    );

  await appendAuditEvent(tx, ctx, envelope, {
    eventType:
      status === "COMPLETED" ? "work_order.completed" : "work_order.completion_submitted",
    entityType: "work_order",
    entityId: workOrder.id,
    beforeState: {
      status: workOrder.status,
      declaredCostMinor: workOrder.declaredCostMinor?.toString() ?? null,
      costOutcome: workOrder.costOutcome,
      summary: workOrder.summary,
      resolveLinkedIssue: workOrder.resolveLinkedIssue,
      completionRejectReason: workOrder.completionRejectReason,
      completedAt: workOrder.completedAt?.toISOString() ?? null,
      rowVersion: workOrder.rowVersion,
    },
    afterState: {
      status,
      declaredCostMinor:
        request.declaredCostMinor === null ? null : Number(request.declaredCostMinor),
      costOutcome: request.costOutcome,
      // The entries this close wrote; each has its own audit event too.
      costEntryIds: children.map((child) => child.id),
      summary: request.summary ?? null,
      resolveLinkedIssue,
      completionRejectReason: null,
      completedAt: completedAt.toISOString(),
      rowVersion,
    },
    changedFields: [
      "status",
      "declaredCostMinor",
      "costOutcome",
      "summary",
      "resolveLinkedIssue",
      "completionRejectReason",
      "completedAt",
      "rowVersion",
    ],
  });

  if (status === "COMPLETED" && resolveLinkedIssue) {
    await resolveLinkedIssueOnCompletion(tx, ctx, envelope, workOrder, request.summary);
  }

  return {
    recordId: workOrder.id,
    rowVersion,
    recordStatus: status,
    warnings: [...warnings],
    ...(children.length === 0 ? {} : { children }),
  };
}

const completionDefinition = {
  name: "complete-work-order",
  module: "MAINTENANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "TECHNICIAN"],
  approvalMode: "SUBMIT",
  // No operationalAssetId on purpose: an open order on a disposed asset can still be closed; costs cannot attach, the writer keeps that guard.
  branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },
} as const satisfies Partial<CommandDefinition<unknown>>;

/**
 * The workshop declaring the job finished, with its cost (#81). APPROVED →
 * COMPLETED (auto band) or COMPLETION_SUBMITTED for approve-work-order-closure
 * / reject-work-order-completion.
 *
 * The band is read on the derived total: what the books already hold against
 * the order plus the lines this close adds, pending ones included — a cost
 * awaiting review is still a cost the approver should see before the job
 * closes. The completion facts are stamped either way: they are what an
 * approver is asked to look at, and a held completion acts on its
 * resolve-the-issue flag only once approved.
 */
export const completeWorkOrder: CommandDefinition<CompleteWorkOrderPayload> = {
  ...completionDefinition,
  version: 2,
  payloadSchema: completeWorkOrderPayload,

  async approvalContext(tx, ctx, payload) {
    // Sequential: one transaction owns one connection.
    const branchId = await workOrderAssetBranchId(tx, ctx, payload.workOrderId);
    const recorded = await workOrderLedgerTotal(tx, ctx, payload.workOrderId);
    const added = payload.costLines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    return {
      ...(branchId === undefined ? {} : { branchId }),
      amountMinor: Number(recorded + added),
    };
  },

  execute(tx, ctx, envelope, payload, approval) {
    return executeCompletion(
      tx,
      ctx,
      envelope,
      {
        workOrderId: payload.workOrderId,
        summary: payload.summary,
        resolveLinkedIssue: payload.resolveLinkedIssue,
        costOutcome: payload.costOutcome,
        costLines: payload.costLines,
        declaredCostMinor: null,
      },
      approval,
    );
  },
};

/**
 * The compatibility half of the version bump (ARCHITECTURE.md §6), as
 * provision-workspace v1 → v2 did. A v1 close writes no cost line: its typed
 * amount is stored as the closer's declaration and never becomes the actual
 * cost. The band keeps v1's rule — the larger of the declaration and the books
 * — so an old client cannot slip a close under a threshold by typing less than
 * what it declares elsewhere; it can only be held for review, never waved
 * through.
 */
export const completeWorkOrderV1: CommandDefinition<CompleteWorkOrderV1Payload> = {
  ...completionDefinition,
  version: 1,
  payloadSchema: completeWorkOrderV1Payload,

  async approvalContext(tx, ctx, payload) {
    const branchId = await workOrderAssetBranchId(tx, ctx, payload.workOrderId);
    const recorded = await workOrderLedgerTotal(tx, ctx, payload.workOrderId);
    const declared = BigInt(payload.actualCostMinor ?? 0);
    return {
      ...(branchId === undefined ? {} : { branchId }),
      amountMinor: Number(declared > recorded ? declared : recorded),
    };
  },

  execute(tx, ctx, envelope, payload, approval) {
    return executeCompletion(
      tx,
      ctx,
      envelope,
      {
        workOrderId: payload.workOrderId,
        summary: payload.summary,
        resolveLinkedIssue: payload.resolveLinkedIssue,
        costOutcome: null,
        costLines: [],
        declaredCostMinor:
          payload.actualCostMinor === undefined ? null : BigInt(payload.actualCostMinor),
      },
      approval,
    );
  },
};

const CANCELLABLE = new Set<WorkOrderRow["status"]>([
  "SUBMITTED",
  "APPROVED",
  "COMPLETION_SUBMITTED",
]);

/**
 * Calling the job off, from any state that is not terminal (#28). Posted costs
 * stand — abandoning a repair does not unspend money — and there is no
 * auto-reversal: correcting them is a finance decision taken by reverse-entry.
 * A terminal order is append-only history, and re-cancelling a cancelled one
 * would rewrite the reason the first cancellation recorded. The same
 * signalement can spawn a new order.
 */
export const cancelWorkOrder: CommandDefinition<CancelWorkOrderPayload> = {
  name: "cancel-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "TECHNICIAN"],
  payloadSchema: cancelWorkOrderPayload,
  branchAuthorization: { kind: "branches", resolve: workOrderBranchIds },

  async execute(tx, ctx, envelope, payload) {
    const workOrder = await loadWorkOrderForUpdate(tx, ctx, payload.workOrderId);
    checkOptimisticVersion(envelope, workOrder.rowVersion);

    if (!CANCELLABLE.has(workOrder.status)) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: "CANCELLED",
      });
    }

    const cancelledAt = new Date();
    const rowVersion = workOrder.rowVersion + 1;

    await tx
      .update(workOrders)
      .set({
        status: "CANCELLED",
        cancelReason: payload.reason,
        cancelledAt,
        rowVersion,
      })
      .where(
        and(
          eq(workOrders.workspaceId, ctx.workspaceId),
          eq(workOrders.id, workOrder.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.cancelled",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: workOrder.status,
        cancelReason: workOrder.cancelReason,
        cancelledAt: workOrder.cancelledAt?.toISOString() ?? null,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status: "CANCELLED",
        cancelReason: payload.reason,
        cancelledAt: cancelledAt.toISOString(),
        rowVersion,
      },
      changedFields: ["status", "cancelReason", "cancelledAt", "rowVersion"],
    });

    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: "CANCELLED",
      warnings: [],
    };
  },
};

registerCommand(createWorkOrder);
registerCommand(completeWorkOrder);
registerCommand(completeWorkOrderV1);
registerCommand(cancelWorkOrder);
