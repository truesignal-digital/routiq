import {
  approveWorkOrderPayload,
  cancelWorkOrderPayload,
  completeWorkOrderPayload,
  createWorkOrderPayload,
  rejectWorkOrderPayload,
  type ApproveWorkOrderPayload,
  type CancelWorkOrderPayload,
  type CommandEnvelope,
  type CompleteWorkOrderPayload,
  type CreateWorkOrderPayload,
  type CommandWarningCode,
  type RejectWorkOrderPayload,
} from "@routiq/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  assets,
  branches,
  categories,
  commands,
  financialEntries,
  financialPostings,
  operationalIssues,
  workOrders,
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
import { nextWorkOrderNumber } from "./numbering.js";
import { openAvailabilityInterval } from "./operational-issues.js";

/**
 * The WO's actual cost: signed sum of its ledger postings (§4.2 — POSTED plus
 * REVERSED so a reversal pair nets to zero), expenses positive. Derived on
 * demand, never a hand-maintained total; `work_orders.actual_cost_minor` only
 * snapshots what the completion gate matched on.
 */
export async function workOrderPostedCostMinor(
  tx: Tx,
  ctx: CommandContext,
  workOrderId: string,
): Promise<bigint> {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'EXPENSE' then ${financialPostings.amountMinor} else -${financialPostings.amountMinor} end), 0)::text`,
    })
    .from(financialPostings)
    .innerJoin(
      financialEntries,
      and(
        eq(financialEntries.workspaceId, financialPostings.workspaceId),
        eq(financialEntries.id, financialPostings.financialEntryId),
      ),
    )
    .where(
      and(
        eq(financialPostings.workspaceId, ctx.workspaceId),
        eq(financialPostings.workOrderId, workOrderId),
        inArray(financialEntries.status, ["POSTED", "REVERSED"]),
      ),
    );
  return BigInt(row?.total ?? "0");
}

function toSafeMinor(value: bigint): number {
  const serialized = Number(value);
  if (!Number.isSafeInteger(serialized)) {
    throw new Error(`Minor amount ${value} exceeds MAX_SAFE_INTEGER`);
  }
  return serialized;
}

async function workOrderBranchIdsFor(
  tx: Tx,
  ctx: CommandContext,
  payload: { workOrderId: string },
): Promise<string[]> {
  const [workOrder] = await tx
    .select({ branchId: workOrders.branchId })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.workspaceId, ctx.workspaceId),
        eq(workOrders.id, payload.workOrderId),
      ),
    );
  return workOrder ? [workOrder.branchId] : [];
}

async function selectWorkOrderForUpdate(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  workOrderId: string,
) {
  const [workOrder] = await tx
    .select()
    .from(workOrders)
    .where(
      and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrderId)),
    )
    .for("update");

  if (!workOrder) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "workOrder",
      referenceId: workOrderId,
    });
  }

  checkOptimisticVersion(envelope, workOrder.rowVersion);
  return workOrder;
}

/**
 * Maker ≠ approver, per gate (#28): a SUBMITTED WO was made by whoever created
 * it; a COMPLETION_SUBMITTED one by whoever submitted the completion. The same
 * person may well be both — creating and completing your own WO is normal;
 * deciding your own submission is not.
 */
async function assertNotMaker(
  tx: Tx,
  ctx: CommandContext,
  workOrder: typeof workOrders.$inferSelect,
): Promise<void> {
  if (workOrder.status === "COMPLETION_SUBMITTED") {
    if (workOrder.completedByPrincipalId === ctx.principalId) {
      throw new CommandError(403, "MAKER_CANNOT_APPROVE");
    }
    return;
  }
  const [maker] = await tx
    .select({ initiatedByPrincipalId: commands.initiatedByPrincipalId })
    .from(commands)
    .where(
      and(
        eq(commands.workspaceId, ctx.workspaceId),
        eq(commands.id, workOrder.createdByCommandId),
      ),
    );
  if (maker?.initiatedByPrincipalId === ctx.principalId) {
    throw new CommandError(403, "MAKER_CANNOT_APPROVE");
  }
}

/**
 * The piggybacked closure (#28): completion may resolve the linked issue in the
 * same transaction. Skips silently when the issue already left OPEN — someone
 * resolved or dismissed it standalone in the meantime, which is not an error.
 */
async function resolveLinkedIssue(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  workOrder: { operationalIssueId: string | null; assetId: string },
  resolvedAt: Date,
): Promise<CommandWarningCode[]> {
  if (workOrder.operationalIssueId === null) return [];
  const [issue] = await tx
    .select()
    .from(operationalIssues)
    .where(
      and(
        eq(operationalIssues.workspaceId, ctx.workspaceId),
        eq(operationalIssues.id, workOrder.operationalIssueId),
      ),
    )
    .for("update");
  if (!issue || issue.status !== "OPEN") return [];

  const rowVersion = issue.rowVersion + 1;
  await tx
    .update(operationalIssues)
    .set({ status: "RESOLVED", resolvedAt, rowVersion })
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
      rowVersion: issue.rowVersion,
    },
    afterState: {
      status: "RESOLVED",
      resolvedAt: resolvedAt.toISOString(),
      rowVersion,
    },
    changedFields: ["status", "resolvedAt", "rowVersion"],
  });

  const interval = await openAvailabilityInterval(tx, ctx, workOrder.assetId);
  return interval?.openedByIssueId === issue.id
    ? ["ISSUE_CLOSED_ASSET_STILL_UNAVAILABLE"]
    : [];
}

registerCommand<CreateWorkOrderPayload>({
  name: "create-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["MAINTENANCE", "OPS_MANAGER", "ADMIN"],
  payloadSchema: createWorkOrderPayload,
  approvalMode: "SUBMIT",
  operationalAssetId: (payload) => payload.assetId,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },

  /**
   * Spend authorization matches on the EXPECTED cost — and on the linked
   * issue's category, so a tenant can band "brake work needs review" apart
   * from "tires under 50k are fine".
   */
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
    let categoryCode: string | undefined;
    if (payload.issueId !== undefined) {
      const [issueCategory] = await tx
        .select({ code: categories.code })
        .from(operationalIssues)
        .innerJoin(
          categories,
          and(
            eq(categories.workspaceId, operationalIssues.workspaceId),
            eq(categories.id, operationalIssues.categoryId),
          ),
        )
        .where(
          and(
            eq(operationalIssues.workspaceId, ctx.workspaceId),
            eq(operationalIssues.id, payload.issueId),
          ),
        );
      categoryCode = issueCategory?.code;
    }
    return {
      amountMinor: payload.expectedCostMinor,
      ...(row === undefined ? {} : { branchCode: row.branchCode }),
      ...(categoryCode === undefined ? {} : { categoryCode }),
    };
  },

  async execute(tx, ctx, envelope, payload, approval) {
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

    if (payload.issueId !== undefined) {
      const [issue] = await tx
        .select({
          id: operationalIssues.id,
          assetId: operationalIssues.assetId,
          status: operationalIssues.status,
        })
        .from(operationalIssues)
        .where(
          and(
            eq(operationalIssues.workspaceId, ctx.workspaceId),
            eq(operationalIssues.id, payload.issueId),
          ),
        );
      if (!issue) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "operationalIssue",
          referenceId: payload.issueId,
        });
      }
      if (issue.assetId !== payload.assetId) {
        throw new CommandError(422, "WORK_ORDER_ASSET_MISMATCH", {
          issueId: issue.id,
          issueAssetId: issue.assetId,
          workOrderAssetId: payload.assetId,
        });
      }
      if (issue.status !== "OPEN") {
        throw new CommandError(409, "ISSUE_NOT_OPEN", {
          issueId: issue.id,
          status: issue.status,
        });
      }
    }

    const createdAt = new Date();
    const openedAt = payload.openedAt ? new Date(payload.openedAt) : createdAt;
    const branch = { id: asset.branchId, code: asset.branchCode };
    const workOrderNumber = await nextWorkOrderNumber(tx, ctx, branch, openedAt);
    const status = approval.outcome === "AUTO_APPROVED" ? "APPROVED" : "SUBMITTED";

    await tx.insert(workOrders).values({
      id: payload.workOrderId,
      workspaceId: ctx.workspaceId,
      branchId: asset.branchId,
      workOrderNumber,
      assetId: payload.assetId,
      ...(payload.issueId === undefined ? {} : { operationalIssueId: payload.issueId }),
      description: payload.description,
      expectedCostMinor: BigInt(payload.expectedCostMinor),
      currency: payload.currency,
      status,
      openedAt,
      createdByCommandId: envelope.commandId,
      createdAt,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: status === "APPROVED" ? "work_order.approved" : "work_order.submitted",
      entityType: "work_order",
      entityId: payload.workOrderId,
      afterState: {
        id: payload.workOrderId,
        workspaceId: ctx.workspaceId,
        branchId: asset.branchId,
        workOrderNumber,
        assetId: payload.assetId,
        operationalIssueId: payload.issueId ?? null,
        description: payload.description,
        expectedCostMinor: payload.expectedCostMinor,
        currency: payload.currency,
        status,
        openedAt: openedAt.toISOString(),
        rowVersion: 1,
        createdByCommandId: envelope.commandId,
        createdAt: createdAt.toISOString(),
      },
      changedFields: [
        "id",
        "workspaceId",
        "branchId",
        "workOrderNumber",
        "assetId",
        "operationalIssueId",
        "description",
        "expectedCostMinor",
        "currency",
        "status",
        "openedAt",
        "rowVersion",
        "createdByCommandId",
        "createdAt",
      ],
    });

    return {
      recordId: payload.workOrderId,
      rowVersion: 1,
      recordStatus: status,
      warnings: [],
    };
  },
});

registerCommand<ApproveWorkOrderPayload>({
  name: "approve-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"],
  payloadSchema: approveWorkOrderPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: workOrderBranchIdsFor,
  },

  async execute(tx, ctx, envelope, payload) {
    const workOrder = await selectWorkOrderForUpdate(tx, ctx, envelope, payload.workOrderId);
    if (workOrder.status !== "SUBMITTED" && workOrder.status !== "COMPLETION_SUBMITTED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: workOrder.status === "APPROVED" ? "COMPLETED" : "APPROVED",
      });
    }
    await assertNotMaker(tx, ctx, workOrder);

    const rowVersion = workOrder.rowVersion + 1;
    const warnings: CommandWarningCode[] = [];

    if (workOrder.status === "SUBMITTED") {
      await tx
        .update(workOrders)
        .set({ status: "APPROVED", rowVersion })
        .where(
          and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrder.id)),
        );
      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "work_order.approved",
        entityType: "work_order",
        entityId: workOrder.id,
        beforeState: { status: "SUBMITTED", rowVersion: workOrder.rowVersion },
        afterState: {
          status: "APPROVED",
          rowVersion,
          approvalNote: payload.note ?? null,
        },
        changedFields: ["status", "rowVersion"],
      });
      return {
        recordId: workOrder.id,
        rowVersion,
        recordStatus: "APPROVED",
        warnings,
      };
    }

    // COMPLETION_SUBMITTED → COMPLETED: the held completion facts now apply.
    await tx
      .update(workOrders)
      .set({ status: "COMPLETED", rowVersion })
      .where(
        and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrder.id)),
      );
    if (workOrder.resolveLinkedIssue === true) {
      warnings.push(
        ...(await resolveLinkedIssue(
          tx,
          ctx,
          envelope,
          workOrder,
          workOrder.completedAt ?? new Date(),
        )),
      );
    }
    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.completed",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: { status: "COMPLETION_SUBMITTED", rowVersion: workOrder.rowVersion },
      afterState: {
        status: "COMPLETED",
        rowVersion,
        approvalNote: payload.note ?? null,
      },
      changedFields: ["status", "rowVersion"],
    });
    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: "COMPLETED",
      warnings,
    };
  },
});

registerCommand<RejectWorkOrderPayload>({
  name: "reject-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"],
  payloadSchema: rejectWorkOrderPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: workOrderBranchIdsFor,
  },

  async execute(tx, ctx, envelope, payload) {
    const workOrder = await selectWorkOrderForUpdate(tx, ctx, envelope, payload.workOrderId);
    if (workOrder.status !== "SUBMITTED" && workOrder.status !== "COMPLETION_SUBMITTED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: "REJECTED",
      });
    }
    await assertNotMaker(tx, ctx, workOrder);

    const rowVersion = workOrder.rowVersion + 1;

    if (workOrder.status === "SUBMITTED") {
      await tx
        .update(workOrders)
        .set({ status: "REJECTED", rejectedReason: payload.reason, rowVersion })
        .where(
          and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrder.id)),
        );
      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "work_order.rejected",
        entityType: "work_order",
        entityId: workOrder.id,
        beforeState: {
          status: "SUBMITTED",
          rejectedReason: null,
          rowVersion: workOrder.rowVersion,
        },
        afterState: {
          status: "REJECTED",
          rejectedReason: payload.reason,
          rowVersion,
        },
        changedFields: ["status", "rejectedReason", "rowVersion"],
      });
      return {
        recordId: workOrder.id,
        rowVersion,
        recordStatus: "REJECTED",
        warnings: [],
      };
    }

    /*
     * Completion rejection (#28): back to APPROVED — the work stays open, the
     * costs stay correctable, the maker resubmits. The held facts are nulled
     * so an APPROVED WO never looks half-completed; the audit event keeps them.
     */
    await tx
      .update(workOrders)
      .set({
        status: "APPROVED",
        completedAt: null,
        completionNotes: null,
        resolveLinkedIssue: null,
        actualCostMinor: null,
        completedByPrincipalId: null,
        rowVersion,
      })
      .where(
        and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrder.id)),
      );
    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.completion_rejected",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: "COMPLETION_SUBMITTED",
        completedAt: workOrder.completedAt?.toISOString() ?? null,
        completionNotes: workOrder.completionNotes,
        resolveLinkedIssue: workOrder.resolveLinkedIssue,
        actualCostMinor:
          workOrder.actualCostMinor === null ? null : toSafeMinor(workOrder.actualCostMinor),
        completedByPrincipalId: workOrder.completedByPrincipalId,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status: "APPROVED",
        completedAt: null,
        completionNotes: null,
        resolveLinkedIssue: null,
        actualCostMinor: null,
        completedByPrincipalId: null,
        rowVersion,
        rejectionReason: payload.reason,
      },
      changedFields: [
        "status",
        "completedAt",
        "completionNotes",
        "resolveLinkedIssue",
        "actualCostMinor",
        "completedByPrincipalId",
        "rowVersion",
      ],
    });
    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: "APPROVED",
      warnings: [],
    };
  },
});

registerCommand<CompleteWorkOrderPayload>({
  name: "complete-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["MAINTENANCE", "OPS_MANAGER", "ADMIN"],
  payloadSchema: completeWorkOrderPayload,
  approvalMode: "SUBMIT",
  branchAuthorization: {
    kind: "branches",
    resolve: workOrderBranchIdsFor,
  },

  /**
   * The completion gate matches on the ACTUAL posted total — aggregate creep
   * lands in front of an approver even when every line item was in-band.
   */
  async approvalContext(tx, ctx, payload) {
    const [workOrder] = await tx
      .select({
        id: workOrders.id,
        branchCode: branches.code,
      })
      .from(workOrders)
      .innerJoin(
        branches,
        and(
          eq(branches.workspaceId, workOrders.workspaceId),
          eq(branches.id, workOrders.branchId),
        ),
      )
      .where(
        and(
          eq(workOrders.workspaceId, ctx.workspaceId),
          eq(workOrders.id, payload.workOrderId),
        ),
      );
    if (!workOrder) return {};
    const actual = await workOrderPostedCostMinor(tx, ctx, workOrder.id);
    return {
      branchCode: workOrder.branchCode,
      amountMinor: toSafeMinor(actual < 0n ? 0n : actual),
    };
  },

  async execute(tx, ctx, envelope, payload, approval) {
    const workOrder = await selectWorkOrderForUpdate(tx, ctx, envelope, payload.workOrderId);
    if (workOrder.status !== "APPROVED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: "COMPLETED",
      });
    }
    if (payload.resolveLinkedIssue && workOrder.operationalIssueId === null) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "operationalIssue",
        referenceId: null,
      });
    }

    const actualCostMinor = await workOrderPostedCostMinor(tx, ctx, workOrder.id);
    const completedAt = payload.completedAt ? new Date(payload.completedAt) : new Date();
    const completed = approval.outcome === "AUTO_APPROVED";
    const status = completed ? "COMPLETED" : "COMPLETION_SUBMITTED";
    const rowVersion = workOrder.rowVersion + 1;
    const warnings: CommandWarningCode[] = [];

    await tx
      .update(workOrders)
      .set({
        status,
        completedAt,
        completionNotes: payload.notes ?? null,
        resolveLinkedIssue: payload.resolveLinkedIssue,
        actualCostMinor,
        completedByPrincipalId: ctx.principalId,
        rowVersion,
      })
      .where(
        and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrder.id)),
      );

    if (completed && payload.resolveLinkedIssue) {
      warnings.push(
        ...(await resolveLinkedIssue(tx, ctx, envelope, workOrder, completedAt)),
      );
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: completed ? "work_order.completed" : "work_order.completion_submitted",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: "APPROVED",
        completedAt: null,
        completionNotes: null,
        resolveLinkedIssue: null,
        actualCostMinor: null,
        completedByPrincipalId: null,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status,
        completedAt: completedAt.toISOString(),
        completionNotes: payload.notes ?? null,
        resolveLinkedIssue: payload.resolveLinkedIssue,
        actualCostMinor: toSafeMinor(actualCostMinor),
        completedByPrincipalId: ctx.principalId,
        rowVersion,
      },
      changedFields: [
        "status",
        "completedAt",
        "completionNotes",
        "resolveLinkedIssue",
        "actualCostMinor",
        "completedByPrincipalId",
        "rowVersion",
      ],
    });

    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: status,
      warnings,
    };
  },
});

registerCommand<CancelWorkOrderPayload>({
  name: "cancel-work-order",
  version: 1,
  module: "MAINTENANCE",
  allowedRoles: ["MAINTENANCE", "OPS_MANAGER", "ADMIN"],
  payloadSchema: cancelWorkOrderPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: workOrderBranchIdsFor,
  },

  async execute(tx, ctx, envelope, payload) {
    const workOrder = await selectWorkOrderForUpdate(tx, ctx, envelope, payload.workOrderId);
    if (!["SUBMITTED", "APPROVED", "COMPLETION_SUBMITTED"].includes(workOrder.status)) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: workOrder.status,
        to: "CANCELLED",
      });
    }

    /*
     * #28: abandoning a repair doesn't unspend money — the posted costs stand,
     * attributed to asset + WO, and recoverable parts go back through ordinary
     * reversal/return records. Warn, don't block; no auto-reversal.
     */
    const postedCostMinor = await workOrderPostedCostMinor(tx, ctx, workOrder.id);
    const warnings: CommandWarningCode[] =
      postedCostMinor === 0n ? [] : ["WORK_ORDER_CANCELLED_WITH_COSTS"];

    const rowVersion = workOrder.rowVersion + 1;
    await tx
      .update(workOrders)
      .set({ status: "CANCELLED", cancelledReason: payload.reason, rowVersion })
      .where(
        and(eq(workOrders.workspaceId, ctx.workspaceId), eq(workOrders.id, workOrder.id)),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "work_order.cancelled",
      entityType: "work_order",
      entityId: workOrder.id,
      beforeState: {
        status: workOrder.status,
        cancelledReason: null,
        rowVersion: workOrder.rowVersion,
      },
      afterState: {
        status: "CANCELLED",
        cancelledReason: payload.reason,
        postedCostMinor: toSafeMinor(postedCostMinor),
        rowVersion,
      },
      changedFields: ["status", "cancelledReason", "rowVersion"],
    });

    return {
      recordId: workOrder.id,
      rowVersion,
      recordStatus: "CANCELLED",
      warnings,
    };
  },
});
