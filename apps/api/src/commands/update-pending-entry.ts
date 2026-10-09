import {
  updatePendingEntryPayload,
  type CommandWarningCode,
  type UpdatePendingEntryPayload,
} from "@routiq/contracts";
import { and, asc, eq } from "drizzle-orm";
import { commands, financialEntries, financialPostings } from "../db/schema.js";
import { entryEvidenceFiles } from "../reads/entry-evidence.js";
import { evaluateApproval } from "./approvals.js";
import { assetBranchIds } from "./branch-authorization.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import {
  assertPostingsBalance,
  evidenceMissing,
  postingRowsFor,
  resolveEntryReferences,
  resolvePostingOrDefer,
  type FinancialEntryFacts,
} from "./financial-entry-writer.js";
import { requireRecordRole, requireWorkOrderAttribution } from "./record-financial-entry.js";

const COMMAND = "update-pending-entry";

/** What the stored direction makes of the edit: whose rules, which categories. */
const BY_DIRECTION = {
  EXPENSE: {
    recordCommand: "record-expense",
    categoryKind: "EXPENSE_CATEGORY",
    categoryRefType: "expenseCategory",
  },
  REVENUE: {
    recordCommand: "record-revenue",
    categoryKind: "REVENUE_CATEGORY",
    categoryRefType: "revenueCategory",
  },
} as const;

type PostingRow = typeof financialPostings.$inferSelect;
type PostingInsert = ReturnType<typeof postingRowsFor>[number];

/** A line's business content: what the edit may change, without ids or stamps. */
function lineFacts(row: PostingRow | PostingInsert) {
  return {
    lineNo: row.lineNo,
    economicDate: row.economicDate,
    categoryId: row.categoryId,
    assetId: row.assetId ?? null,
    activityId: row.activityId ?? null,
    workOrderId: row.workOrderId ?? null,
    personId: row.personId ?? null,
    amountMinor: Number(row.amountMinor),
    assetAttribution: row.assetAttribution,
    activityAttribution: row.activityAttribution ?? "DIRECT",
  };
}

function sameLines(stored: PostingRow[], next: PostingInsert[]): boolean {
  return (
    JSON.stringify(stored.map(lineFacts)) === JSON.stringify(next.map(lineFacts))
  );
}

/** Lines as the audit trail keeps them: a replaced line exists nowhere else. */
function auditLines(rows: Array<PostingRow | PostingInsert>) {
  return rows.map((row) => ({
    id: row.id,
    ...lineFacts(row),
    postingPeriodId: row.postingPeriodId ?? null,
    createdByCommandId: row.createdByCommandId,
  }));
}

/**
 * The author's own edit of an entry nobody has decided yet (#85, level 2 of
 * ADR-0008). Until an approver acts, nothing has been relied on, so the entry
 * changes in place rather than being reversed: same id, same number, same
 * branch, one audit event holding what it said before and after.
 *
 * Only the author, whatever their role: an approver or admin who disagrees
 * rejects it. And only an author whose role may still record the entry's
 * direction: a driver records expenses only, so never edits revenue (#572). Only while SUBMITTED, at the version the author was shown, so an
 * approver acting first turns the author's save into VERSION_CONFLICT.
 *
 * The approval rules run again on the new facts, under record-expense or
 * record-revenue (as the sheets do): an edit into the auto-approve band posts
 * the entry, an edit that stays above it leaves it waiting. The lines are
 * replaced only when their content moves; the database still checks at commit
 * that they sum to the entry (0031, 0034).
 */
export const updatePendingEntry: CommandDefinition<UpdatePendingEntryPayload> = {
  name: COMMAND,
  version: 1,
  module: "FINANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
  payloadSchema: updatePendingEntryPayload,
  branchAuthorization: {
    kind: "branches",
    async resolve(tx, ctx, payload) {
      const [entry] = await tx
        .select({ branchId: financialEntries.branchId })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.workspaceId, ctx.workspaceId),
            eq(financialEntries.id, payload.entryId),
          ),
        )
        .limit(1);
      const postingAssetIds = payload.postings.flatMap((posting) =>
        posting.assetId === undefined ? [] : [posting.assetId],
      );
      // A missing entry resolves to no branch of its own, so the handler can
      // answer REFERENCE_NOT_FOUND with the id rather than scope answering 403.
      return [
        ...new Set([
          ...(entry ? [entry.branchId] : []),
          ...(await assetBranchIds(tx, ctx, postingAssetIds)),
        ]),
      ];
    },
  },

  async execute(tx, ctx, envelope, payload) {
    const [entry] = await tx
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, ctx.workspaceId),
          eq(financialEntries.id, payload.entryId),
        ),
      )
      .for("update");
    if (!entry) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "financialEntry",
        referenceId: payload.entryId,
      });
    }

    const [maker] = await tx
      .select({ initiatedByPrincipalId: commands.initiatedByPrincipalId })
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, ctx.workspaceId),
          eq(commands.id, entry.createdByCommandId),
        ),
      );
    if (maker?.initiatedByPrincipalId !== ctx.principalId) {
      throw new CommandError(403, "NOT_ENTRY_AUTHOR");
    }

    checkOptimisticVersion(envelope, entry.rowVersion);

    // A reversal row is born POSTED, so this also keeps reversals out.
    if (entry.status !== "SUBMITTED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        entityType: "financial_entry",
        status: entry.status,
        reason: "not_pending",
      });
    }

    // Files reach an entry through attach-evidence, whose audit event is how
    // the reads find them. Linked to this command instead, they would count
    // nowhere.
    if (envelope.sourceArtifactIds.length > 0) {
      throw new CommandError(400, "VALIDATION_FAILED", {
        issues: [{ code: "custom", path: ["envelope", "sourceArtifactIds"] }],
      });
    }

    const direction = BY_DIRECTION[entry.direction];
    requireRecordRole(ctx.role, direction.recordCommand);
    requireWorkOrderAttribution(ctx.role, payload, COMMAND);

    const { entryId: _entryId, ...fields } = payload;
    const facts: FinancialEntryFacts = {
      ...fields,
      direction: entry.direction,
      categoryKind: direction.categoryKind,
      categoryRefType: direction.categoryRefType,
    };
    assertPostingsBalance(facts);
    const { category, lateWorkOrderCost } = await resolveEntryReferences(tx, ctx, facts);

    // Under the standalone command's rules, as the sheets evaluate their
    // entries: thresholds are tenant-editable per command type, and a second
    // set for edits would be a threshold nobody knows to configure.
    const approval = await evaluateApproval(tx, ctx, envelope, direction.recordCommand, {
      branchId: entry.branchId,
      categoryCode: payload.categoryCode,
      amountMinor: payload.amountMinor,
      // An edit cannot move a late repair invoice into the auto band (#82).
      requiresReview: lateWorkOrderCost,
    });
    const posting = await resolvePostingOrDefer(tx, ctx, envelope, payload.economicDate, approval);
    const postingPeriodId = posting.period?.periodId ?? null;

    const storedLines = await tx
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, ctx.workspaceId),
          eq(financialPostings.financialEntryId, entry.id),
        ),
      )
      .orderBy(asc(financialPostings.lineNo));
    const nextLines = postingRowsFor(ctx, envelope, {
      entryId: entry.id,
      facts,
      categoryId: category.id,
      branchId: entry.branchId,
      postingPeriodId,
      createdAt: new Date(),
    });
    const replaceLines = !sameLines(storedLines, nextLines);

    const before = {
      categoryId: entry.categoryId,
      economicDate: entry.economicDate,
      counterpartyName: entry.counterpartyName,
      description: entry.description,
      amountMinor: Number(entry.amountMinor),
      currency: entry.currency,
      paymentMethod: entry.paymentMethod,
      paymentReference: entry.paymentReference,
      sourceReference: entry.sourceReference,
      estimateStatus: entry.estimateStatus,
    };
    const after: typeof before = {
      categoryId: category.id,
      economicDate: payload.economicDate,
      counterpartyName: payload.counterpartyName ?? null,
      description: payload.description ?? null,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      paymentMethod: payload.paymentMethod,
      paymentReference: payload.paymentReference ?? null,
      sourceReference: payload.sourceReference ?? null,
      estimateStatus: payload.estimateStatus,
    };
    const changedFacts = (Object.keys(before) as Array<keyof typeof before>).filter(
      (field) => before[field] !== after[field],
    );

    const rowVersion = entry.rowVersion + 1;
    await tx
      .update(financialEntries)
      .set({ ...after, amountMinor: BigInt(after.amountMinor), rowVersion })
      .where(
        and(
          eq(financialEntries.workspaceId, ctx.workspaceId),
          eq(financialEntries.id, entry.id),
        ),
      );

    if (replaceLines) {
      await tx
        .delete(financialPostings)
        .where(
          and(
            eq(financialPostings.workspaceId, ctx.workspaceId),
            eq(financialPostings.financialEntryId, entry.id),
          ),
        );
      await tx.insert(financialPostings).values(nextLines);
    } else if (postingPeriodId !== null) {
      await tx
        .update(financialPostings)
        .set({ postingPeriodId })
        .where(
          and(
            eq(financialPostings.workspaceId, ctx.workspaceId),
            eq(financialPostings.financialEntryId, entry.id),
          ),
        );
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "financial_entry.updated",
      entityType: "financial_entry",
      entityId: entry.id,
      beforeState: {
        ...before,
        status: entry.status,
        rowVersion: entry.rowVersion,
        ...(replaceLines ? { postings: auditLines(storedLines) } : {}),
      },
      afterState: {
        ...after,
        status: entry.status,
        rowVersion,
        ...(replaceLines ? { postings: auditLines(nextLines) } : {}),
      },
      changedFields: [...changedFacts, ...(replaceLines ? ["postings"] : []), "rowVersion"],
    });

    let postedAt: Date | undefined;
    if (posting.isPosted && posting.period !== undefined) {
      postedAt = new Date();
      // A second statement, so the database sees facts change only while the
      // entry is still pending, and the posting as a plain lifecycle step.
      await tx
        .update(financialEntries)
        .set({
          status: "POSTED",
          postingPeriodId: posting.period.periodId,
          isLatePosting: posting.period.isLatePosting,
          postedAt,
        })
        .where(
          and(
            eq(financialEntries.workspaceId, ctx.workspaceId),
            eq(financialEntries.id, entry.id),
          ),
        );
      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "financial_entry.posted",
        entityType: "financial_entry",
        entityId: entry.id,
        beforeState: {
          status: "SUBMITTED",
          postingPeriodId: null,
          isLatePosting: false,
          postedAt: null,
          rowVersion,
        },
        afterState: {
          status: "POSTED",
          postingPeriodId: posting.period.periodId,
          isLatePosting: posting.period.isLatePosting,
          postedAt: postedAt.toISOString(),
          rowVersion,
        },
        changedFields: ["status", "postingPeriodId", "isLatePosting", "postedAt"],
      });
    }

    const warnings: CommandWarningCode[] = [...posting.warnings];
    const files = await entryEvidenceFiles(tx, ctx.workspaceId, entry);
    if (evidenceMissing(category, payload, files.length)) warnings.push("EVIDENCE_MISSING");
    if (posting.period?.isLatePosting === true) warnings.push("LATE_POSTING");

    return {
      recordId: entry.id,
      rowVersion,
      recordStatus: postedAt === undefined ? "SUBMITTED" : "POSTED",
      warnings,
    };
  },
};

registerCommand(updatePendingEntry);
