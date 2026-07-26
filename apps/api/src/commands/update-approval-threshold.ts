import { updateApprovalThresholdPayload } from "@routiq/contracts";
import type { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { approvalRules } from "../db/schema.js";
import { appendAuditEvent, CommandError, registerCommand, type CommandDefinition } from "./dispatcher.js";

type UpdateApprovalThresholdPayload = z.infer<
  typeof updateApprovalThresholdPayload
>;

const updateApprovalThresholdCommand: CommandDefinition<
  UpdateApprovalThresholdPayload
> = {
  name: "update-approval-threshold",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: updateApprovalThresholdPayload,
  branchAuthorization: { kind: "workspace" },
  async execute(tx, ctx, envelope, payload) {
    // Get the band rules (those with non-null amountMaxMinor) for this commandType
    const bandRules = await tx
      .select()
      .from(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, ctx.workspaceId),
          eq(approvalRules.commandType, payload.commandType),
          isNull(approvalRules.categoryCode),
          isNull(approvalRules.branchId),
          isNull(approvalRules.amountMinMinor),
        ),
      );

    // Filter in JS to get only the rules with amountMaxMinor set
    const rulesToUpdate = bandRules.filter((r) => r.amountMaxMinor !== null);

    if (rulesToUpdate.length === 0) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND");
    }

    // Update each band rule and collect audit info
    const newAmountMaxMinor = BigInt(payload.amountMaxMinor);
    
    for (const rule of rulesToUpdate) {
      const newRowVersion = rule.rowVersion + 1;

      const [updated] = await tx
        .update(approvalRules)
        .set({
          amountMaxMinor: newAmountMaxMinor,
          rowVersion: newRowVersion,
        })
        .where(eq(approvalRules.id, rule.id))
        .returning();

      if (!updated) throw new Error("approval_rules update returned no row");
    }

    // Audit event with before/after amounts
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
