import {
  reverseEntryPayload,
  reverseEntryV1Payload,
  reverseEntryV1ToV2,
  type ReverseEntryPayload,
  type ReverseEntryV1Payload,
} from "@routiq/contracts";
import { and, asc, eq } from "drizzle-orm";
import {
  branches,
  financialEntries,
  financialPostings,
} from "../db/schema.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { nextEntryNumber } from "./numbering.js";
import { resolvePostingPeriod } from "./periods.js";

/**
 * "Cancel entry" in the interface (#426); a reversal underneath. v2 takes the
 * reason from a short list; v1's free text runs the same path as OTHER.
 */
const reverseEntry = {
  name: "reverse-entry",
  module: "FINANCE",
  allowedRoles: ["DIRECTOR", "FINANCE"],
  branchAuthorization: {
    kind: "branches",
    async resolve(tx, ctx, payload) {
      const [entry] = await tx
        .select({ branchId: financialEntries.branchId })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.workspaceId, ctx.workspaceId),
            eq(financialEntries.id, payload.originalEntryId),
          ),
        )
        .limit(1);
      return entry ? [entry.branchId] : [];
    },
  },
} as const satisfies Partial<CommandDefinition<{ originalEntryId: string }>>;

registerCommand<ReverseEntryPayload>({
  ...reverseEntry,
  version: 2,
  payloadSchema: reverseEntryPayload,
  execute: (tx, ctx, envelope, payload) => executeReversal(tx, ctx, envelope, payload),
});

registerCommand<ReverseEntryV1Payload>({
  ...reverseEntry,
  version: 1,
  payloadSchema: reverseEntryV1Payload,
  execute: (tx, ctx, envelope, payload) =>
    executeReversal(tx, ctx, envelope, reverseEntryV1ToV2(payload)),
});

type ExecuteArgs = Parameters<CommandDefinition<ReverseEntryPayload>["execute"]>;

async function executeReversal(
  tx: ExecuteArgs[0],
  ctx: ExecuteArgs[1],
  envelope: ExecuteArgs[2],
  payload: ReverseEntryPayload,
) {
  const [original] = await tx
    .select()
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.workspaceId, ctx.workspaceId),
        eq(financialEntries.id, payload.originalEntryId),
      ),
    )
    .for("update");

  if (!original) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "financialEntry",
      referenceId: payload.originalEntryId,
    });
  }

  checkOptimisticVersion(envelope, original.rowVersion);

  // One level only (#130): undoing a mistaken reversal means recording the
  // entry again, never reversing the reversal.
  if (original.reversesEntryId !== null) {
    throw new CommandError(409, "ENTRY_IS_REVERSAL", {
      originalEntryId: payload.originalEntryId,
      reversesEntryId: original.reversesEntryId,
    });
  }
  if (original.status === "REVERSED") {
    throw new CommandError(409, "ENTRY_ALREADY_REVERSED", {
      originalEntryId: payload.originalEntryId,
    });
  }
  if (original.status !== "POSTED") {
    throw new CommandError(409, "INVALID_STATE_TRANSITION", {
      from: original.status,
      to: "REVERSED",
    });
  }

  const [originalPostings, branchRows] = await Promise.all([
    tx
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, ctx.workspaceId),
          eq(financialPostings.financialEntryId, original.id),
        ),
      )
      .orderBy(asc(financialPostings.lineNo)),
    tx
      .select({ id: branches.id, code: branches.code })
      .from(branches)
      .where(
        and(
          eq(branches.workspaceId, ctx.workspaceId),
          eq(branches.id, original.branchId),
        ),
      )
      .limit(1),
  ]);
  const [branch] = branchRows;
  if (!branch) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "branch",
      referenceId: original.branchId,
    });
  }

  const period = await resolvePostingPeriod(
    tx,
    ctx,
    original.economicDate,
    envelope.commandId,
  );
  const warnings = period.isLatePosting ? (["LATE_POSTING"] as const) : [];
  const entryNumber = await nextEntryNumber(
    tx,
    ctx,
    branch,
    original.economicDate,
  );
  const createdAt = new Date();
  const postedAt = createdAt;
  // `reason` stays the free text, as v1 wrote it, so history reads both alike.
  const reasonText = payload.reasonText ?? null;

  await tx.insert(financialEntries).values({
    id: payload.reversalEntryId,
    workspaceId: ctx.workspaceId,
    entryNumber,
    direction: original.direction,
    categoryId: original.categoryId,
    economicDate: original.economicDate,
    postingPeriodId: period.periodId,
    isLatePosting: period.isLatePosting,
    branchId: original.branchId,
    ...(original.counterpartyName === null
      ? {}
      : { counterpartyName: original.counterpartyName }),
    ...(original.description === null
      ? {}
      : { description: original.description }),
    amountMinor: -original.amountMinor,
    currency: original.currency,
    paymentMethod: original.paymentMethod,
    ...(original.paymentReference === null
      ? {}
      : { paymentReference: original.paymentReference }),
    ...(original.sourceReference === null
      ? {}
      : { sourceReference: original.sourceReference }),
    estimateStatus: original.estimateStatus,
    status: "POSTED",
    reversesEntryId: original.id,
    reversalReasonCode: payload.reasonCode,
    reversalReasonText: reasonText,
    postedAt,
    rowVersion: 1,
    createdByCommandId: envelope.commandId,
    createdAt,
  });

  const postingRows = originalPostings.map((posting) => ({
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    financialEntryId: payload.reversalEntryId,
    lineNo: posting.lineNo,
    economicDate: posting.economicDate,
    postingPeriodId: period.periodId,
    direction: original.direction,
    categoryId: posting.categoryId,
    branchId: posting.branchId,
    // Every attribution of the original line, so the negative line subtracts
    // wherever the original counted: the truck, the trip, the person and the
    // repair (§4.2, #60). Never re-checked against the trip's or order's
    // status: a correction is always allowed.
    assetId: posting.assetId,
    activityId: posting.activityId,
    workOrderId: posting.workOrderId,
    personId: posting.personId,
    amountMinor: -posting.amountMinor,
    assetAttribution: posting.assetAttribution,
    activityAttribution: posting.activityAttribution,
    createdByCommandId: envelope.commandId,
    createdAt,
  }));
  await tx.insert(financialPostings).values(postingRows);

  const originalRowVersion = original.rowVersion;
  await tx
    .update(financialEntries)
    .set({
      status: "REVERSED",
      rowVersion: originalRowVersion + 1,
    })
    .where(
      and(
        eq(financialEntries.workspaceId, ctx.workspaceId),
        eq(financialEntries.id, original.id),
      ),
    );

  await appendAuditEvent(tx, ctx, envelope, {
    eventType: "financial_entry.reversal_posted",
    entityType: "financial_entry",
    entityId: payload.reversalEntryId,
    afterState: {
      id: payload.reversalEntryId,
      workspaceId: ctx.workspaceId,
      entryNumber,
      direction: original.direction,
      categoryId: original.categoryId,
      economicDate: original.economicDate,
      postingPeriodId: period.periodId,
      isLatePosting: period.isLatePosting,
      branchId: original.branchId,
      counterpartyName: original.counterpartyName,
      description: original.description,
      amountMinor: Number(-original.amountMinor),
      currency: original.currency,
      paymentMethod: original.paymentMethod,
      paymentReference: original.paymentReference,
      sourceReference: original.sourceReference,
      estimateStatus: original.estimateStatus,
      status: "POSTED",
      rejectedReason: null,
      reversesEntryId: original.id,
      postedAt: postedAt.toISOString(),
      rowVersion: 1,
      createdByCommandId: envelope.commandId,
      createdAt: createdAt.toISOString(),
      reasonCode: payload.reasonCode,
      reason: reasonText,
      postings: postingRows.map((posting) => ({
        ...posting,
        amountMinor: Number(posting.amountMinor),
        createdAt: posting.createdAt.toISOString(),
      })),
    },
    changedFields: [
      "id",
      "workspaceId",
      "entryNumber",
      "direction",
      "categoryId",
      "economicDate",
      "postingPeriodId",
      "isLatePosting",
      "branchId",
      "counterpartyName",
      "description",
      "amountMinor",
      "currency",
      "paymentMethod",
      "paymentReference",
      "sourceReference",
      "estimateStatus",
      "status",
      "rejectedReason",
      "reversesEntryId",
      "postedAt",
      "rowVersion",
      "createdByCommandId",
      "createdAt",
      "reasonCode",
      "reason",
      "postings",
    ],
  });

  await appendAuditEvent(tx, ctx, envelope, {
    eventType: "financial_entry.reversed",
    entityType: "financial_entry",
    entityId: original.id,
    beforeState: {
      status: "POSTED",
      rowVersion: originalRowVersion,
    },
    afterState: {
      status: "REVERSED",
      rowVersion: originalRowVersion + 1,
      reversedByEntryId: payload.reversalEntryId,
      reasonCode: payload.reasonCode,
      reason: reasonText,
    },
    changedFields: ["status", "rowVersion"],
  });

  return {
    recordId: payload.reversalEntryId,
    rowVersion: 1,
    recordStatus: "POSTED",
    warnings: [...warnings],
  };
}
