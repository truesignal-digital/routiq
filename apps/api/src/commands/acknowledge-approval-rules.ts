import {
  acknowledgeApprovalRulesPayload,
  type AcknowledgeApprovalRulesPayload,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { approvalRuleAcknowledgements, approvalRuleChanges } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";

/**
 * A member has read the approval rules as they now stand (#422). Recorded per
 * member, so the notice stays dismissed on every device; the read shows the
 * latest change the member has not acknowledged.
 */
export const acknowledgeApprovalRules: CommandDefinition<AcknowledgeApprovalRulesPayload> = {
  name: "acknowledge-approval-rules",
  version: 1,
  module: "CORE",
  allowedRoles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
  payloadSchema: acknowledgeApprovalRulesPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const [change] = await tx
      .select({ id: approvalRuleChanges.id })
      .from(approvalRuleChanges)
      .where(
        and(
          eq(approvalRuleChanges.workspaceId, ctx.workspaceId),
          eq(approvalRuleChanges.id, payload.changeId),
        ),
      );
    if (!change) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "approvalRuleChange",
        referenceId: payload.changeId,
      });
    }

    const [row] = await tx
      .insert(approvalRuleAcknowledgements)
      .values({
        workspaceId: ctx.workspaceId,
        changeId: change.id,
        membershipId: ctx.membershipId,
        createdByCommandId: envelope.commandId,
      })
      .onConflictDoNothing()
      .returning({ id: approvalRuleAcknowledgements.id });
    if (!row) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: "ACKNOWLEDGED",
        to: "ACKNOWLEDGED",
      });
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "approval-rules.acknowledged",
      entityType: "approval_rule_change",
      entityId: change.id,
      afterState: { changeId: change.id, membershipId: ctx.membershipId },
      changedFields: ["acknowledged"],
    });

    return { recordId: row.id, rowVersion: 1 };
  },
};

registerCommand(acknowledgeApprovalRules);
