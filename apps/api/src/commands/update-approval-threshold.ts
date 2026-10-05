import { updateApprovalThresholdPayload } from "@routiq/contracts";
import type { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { approvalRules } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";

type UpdateApprovalThresholdPayload = z.infer<
  typeof updateApprovalThresholdPayload
>;
type ApprovalRuleRow = typeof approvalRules.$inferSelect;

/**
 * Command types whose catalog defaults carry no band at all: every maker role
 * auto-approves any amount until a tenant sets a threshold.
 */
const UNBANDED_BY_DEFAULT = new Set(["create-work-order", "complete-work-order"]);

/**
 * The first threshold on a work-order command turns its unbounded defaults into
 * a band of the same shape record-expense ships with: every maker role
 * auto-approves up to the threshold, and the roles that approve work orders
 * (DIRECTOR, ADMIN) keep their unbounded rule beside a new band so their own
 * orders never wait on an approver. Bounding their only rule instead would
 * invert it — the band is the more specific rule, so it wins wherever it
 * matches, and an approver would auto-approve large orders while queueing
 * small ones.
 */
const KEEPS_UNBOUNDED: ReadonlySet<string> = new Set(["DIRECTOR", "ADMIN"]);

async function bandUnboundedDefaults(
  tx: Tx,
  ctx: CommandContext,
  commandId: string,
  commandType: string,
  unbounded: ApprovalRuleRow[],
  amountMaxMinor: bigint,
): Promise<ApprovalRuleRow[]> {
  const banded: ApprovalRuleRow[] = [];
  for (const rule of unbounded) {
    const [row] =
      KEEPS_UNBOUNDED.has(rule.requiredRole)
        ? await tx
            .insert(approvalRules)
            .values({
              workspaceId: ctx.workspaceId,
              commandType,
              categoryCode: null,
              branchId: null,
              amountMinMinor: null,
              amountMaxMinor,
              requiredRole: rule.requiredRole,
              createdByCommandId: commandId,
            })
            .returning()
        : await tx
            .update(approvalRules)
            .set({ amountMaxMinor, rowVersion: rule.rowVersion + 1 })
            .where(eq(approvalRules.id, rule.id))
            .returning();
    if (!row) throw new Error("approval_rules write returned no row");
    banded.push(row);
  }
  return banded;
}

/** One band decides an entry both ways: moving approve-entry's moves reject-entry's. */
function bandedCommandTypes(commandType: string): string[] {
  return commandType === "approve-entry" ? ["approve-entry", "reject-entry"] : [commandType];
}

const updateApprovalThresholdCommand: CommandDefinition<
  UpdateApprovalThresholdPayload
> = {
  name: "update-approval-threshold",
  version: 1,
  module: "CORE",
  allowedRoles: ["DIRECTOR"],
  payloadSchema: updateApprovalThresholdPayload,
  branchAuthorization: { kind: "workspace" },
  async execute(tx, ctx, envelope, payload) {
    // The workspace-wide rules for this command type: no category, no branch,
    // no lower bound. Branch- and category-specific rules are left alone.
    const wildcardRules = await tx
      .select()
      .from(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, ctx.workspaceId),
          inArray(approvalRules.commandType, bandedCommandTypes(payload.commandType)),
          isNull(approvalRules.categoryCode),
          isNull(approvalRules.branchId),
          isNull(approvalRules.amountMinMinor),
        ),
      );
    const rulesToUpdate = wildcardRules.filter((r) => r.amountMaxMinor !== null);
    const newAmountMaxMinor = BigInt(payload.amountMaxMinor);

    if (rulesToUpdate.length === 0 && UNBANDED_BY_DEFAULT.has(payload.commandType)) {
      const banded = await bandUnboundedDefaults(
        tx,
        ctx,
        envelope.commandId,
        payload.commandType,
        wildcardRules,
        newAmountMaxMinor,
      );
      const [first] = banded;
      if (!first) throw new CommandError(422, "REFERENCE_NOT_FOUND");

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: "approval-threshold.updated",
        entityType: "approval_rule",
        entityId: first.id,
        beforeState: { commandType: payload.commandType, amountMaxMinor: null },
        afterState: {
          commandType: payload.commandType,
          amountMaxMinor: payload.amountMaxMinor.toString(),
        },
        changedFields: ["amountMaxMinor", "rowVersion"],
      });
      return { recordId: first.id, rowVersion: first.rowVersion };
    }

    if (rulesToUpdate.length === 0) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND");
    }

    for (const rule of rulesToUpdate) {
      const [updated] = await tx
        .update(approvalRules)
        .set({
          amountMaxMinor: newAmountMaxMinor,
          rowVersion: rule.rowVersion + 1,
        })
        .where(eq(approvalRules.id, rule.id))
        .returning();

      if (!updated) throw new Error("approval_rules update returned no row");
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "approval-threshold.updated",
      entityType: "approval_rule",
      entityId: rulesToUpdate[0]!.id,
      beforeState: {
        commandType: payload.commandType,
        amountMaxMinor: rulesToUpdate[0]!.amountMaxMinor?.toString(),
      },
      afterState: {
        commandType: payload.commandType,
        amountMaxMinor: payload.amountMaxMinor.toString(),
      },
      changedFields: ["amountMaxMinor", "rowVersion"],
    });

    return {
      recordId: rulesToUpdate[0]!.id,
      rowVersion: rulesToUpdate[0]!.rowVersion + 1,
    };
  },
};

registerCommand(updateApprovalThresholdCommand);
