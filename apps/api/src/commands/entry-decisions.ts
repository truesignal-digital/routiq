import { approveEntryPayload, rejectEntryPayload } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { financialEntries, financialPostings } from "../db/schema.js";
import type { ApprovalContext } from "./approvals.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type Tx,
} from "./dispatcher.js";
import { receiptActor } from "./makers.js";
import { resolvePostingPeriod } from "./periods.js";

type ApproveEntryPayload = z.infer<typeof approveEntryPayload>;
type RejectEntryPayload = z.infer<typeof rejectEntryPayload>;
type EntryDecisionPayload = ApproveEntryPayload | RejectEntryPayload;
type EntryDecisionAction = "approve" | "reject";

async function validateAndSelectEntry(
  tx: Tx,
  ctx: CommandContext,
  envelope: Parameters<typeof checkOptimisticVersion>[0],
  payload: EntryDecisionPayload,
  action: EntryDecisionAction,
) {
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

  checkOptimisticVersion(envelope, entry.rowVersion);

  if (entry.status !== "SUBMITTED") {
    throw new CommandError(409, "INVALID_STATE_TRANSITION", {
      from: entry.status,
      to: action === "approve" ? "POSTED" : "REJECTED",
    });
  }

  return entry;
}

/** Locks the entry, so the maker compared is the maker of the row `execute` decides. */
async function entryMaker(
  tx: Tx,
  ctx: CommandContext,
  payload: EntryDecisionPayload,
): Promise<string | undefined> {
  const [entry] = await tx
    .select({ createdByCommandId: financialEntries.createdByCommandId })
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.workspaceId, ctx.workspaceId),
        eq(financialEntries.id, payload.entryId),
      ),
    )
    .for("update");
  return entry ? receiptActor(tx, ctx, entry.createdByCommandId) : undefined;
}

/**
 * The default chain (ADR-0009) bands the decision by the entry's size: Finance
 * decides up to its band (1 000 000 XAF by default), Direction above it. Branch is the
 * entry's own, so a tenant may also route one branch's entries.
 */
async function entryApprovalContext(
  tx: Tx,
  ctx: CommandContext,
  payload: EntryDecisionPayload,
): Promise<ApprovalContext> {
  const [entry] = await tx
    .select({ branchId: financialEntries.branchId, amountMinor: financialEntries.amountMinor })
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.workspaceId, ctx.workspaceId),
        eq(financialEntries.id, payload.entryId),
      ),
    );
  if (!entry) return {};
  return {
    branchId: entry.branchId,
    amountMinor: entry.amountMinor < 0n ? -entry.amountMinor : entry.amountMinor,
  };
}

async function resolveEntryBranchIds(
  tx: Tx,
  ctx: CommandContext,
  payload: EntryDecisionPayload,
): Promise<string[]> {
  const [entry] = await tx
    .select({ branchId: financialEntries.branchId })
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.workspaceId, ctx.workspaceId),
        eq(financialEntries.id, payload.entryId),
      ),
    );
  return entry ? [entry.branchId] : [];
}

registerCommand<ApproveEntryPayload>({
  name: "approve-entry",
  version: 1,
  module: "FINANCE",
  allowedRoles: ["DIRECTOR", "FINANCE"],
  payloadSchema: approveEntryPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: resolveEntryBranchIds,
  },
  maker: entryMaker,
  approvalContext: entryApprovalContext,

  async execute(tx, ctx, envelope, payload) {
    const entry = await validateAndSelectEntry(
      tx,
      ctx,
      envelope,
      payload,
      "approve",
    );
    const period = await resolvePostingPeriod(
      tx,
      ctx,
      entry.economicDate,
      envelope.commandId,
    );
    const warnings = period.isLatePosting ? (["LATE_POSTING"] as const) : [];
    const postedAt = new Date();
    const rowVersion = entry.rowVersion + 1;

    await tx
      .update(financialEntries)
      .set({
        status: "POSTED",
        postingPeriodId: period.periodId,
        isLatePosting: period.isLatePosting,
        postedAt,
        rowVersion,
      })
      .where(
        and(
          eq(financialEntries.workspaceId, ctx.workspaceId),
          eq(financialEntries.id, entry.id),
        ),
      );

    await tx
      .update(financialPostings)
      .set({ postingPeriodId: period.periodId })
      .where(
        and(
          eq(financialPostings.workspaceId, ctx.workspaceId),
          eq(financialPostings.financialEntryId, entry.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "financial_entry.approved",
      entityType: "financial_entry",
      entityId: entry.id,
      beforeState: {
        status: "SUBMITTED",
        postingPeriodId: null,
        isLatePosting: false,
        postedAt: null,
        rowVersion: entry.rowVersion,
      },
      afterState: {
        status: "POSTED",
        postingPeriodId: period.periodId,
        isLatePosting: period.isLatePosting,
        postedAt: postedAt.toISOString(),
        rowVersion,
        approvalNote: payload.note ?? null,
      },
      changedFields: [
        "status",
        "postingPeriodId",
        "isLatePosting",
        "postedAt",
        "rowVersion",
      ],
    });

    return {
      recordId: entry.id,
      rowVersion,
      recordStatus: "POSTED",
      warnings: [...warnings],
    };
  },
});

registerCommand<RejectEntryPayload>({
  name: "reject-entry",
  version: 1,
  module: "FINANCE",
  allowedRoles: ["DIRECTOR", "FINANCE"],
  payloadSchema: rejectEntryPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: resolveEntryBranchIds,
  },
  maker: entryMaker,
  approvalContext: entryApprovalContext,

  async execute(tx, ctx, envelope, payload) {
    const entry = await validateAndSelectEntry(
      tx,
      ctx,
      envelope,
      payload,
      "reject",
    );
    const rowVersion = entry.rowVersion + 1;

    await tx
      .update(financialEntries)
      .set({
        status: "REJECTED",
        rejectedReason: payload.reason,
        rowVersion,
      })
      .where(
        and(
          eq(financialEntries.workspaceId, ctx.workspaceId),
          eq(financialEntries.id, entry.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "financial_entry.rejected",
      entityType: "financial_entry",
      entityId: entry.id,
      beforeState: {
        status: "SUBMITTED",
        rejectedReason: null,
        rowVersion: entry.rowVersion,
      },
      afterState: {
        status: "REJECTED",
        rejectedReason: payload.reason,
        rowVersion,
      },
      changedFields: ["status", "rejectedReason", "rowVersion"],
    });

    return {
      recordId: entry.id,
      rowVersion,
      recordStatus: "REJECTED",
      warnings: [],
    };
  },
});
