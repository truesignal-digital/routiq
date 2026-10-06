import {
  thresholdBandsProblem,
  updateApprovalThresholdV2Payload,
  type UpdateApprovalThresholdV2Payload,
} from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { approvalRules } from "../db/schema.js";
import { loadApprovalBands, RECORDING_BAND_TYPES } from "./approval-bands.js";
import { recordApprovalRuleChange } from "./approval-rule-changes.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";

/**
 * Both bands of the money chain in one change (#354): the recording threshold
 * on record-expense and record-revenue, and the Finance ceiling on
 * approve-entry and reject-entry. Only the workspace-wide bands move, as in
 * v1; Direction's unbounded rules stay, so Direction still posts and decides
 * at any amount. A change that moves nothing writes nothing, so no member is
 * told about it.
 */
const updateApprovalThresholdV2: CommandDefinition<UpdateApprovalThresholdV2Payload> = {
  name: "update-approval-threshold",
  version: 2,
  module: "CORE",
  allowedRoles: ["DIRECTOR"],
  payloadSchema: updateApprovalThresholdV2Payload,
  branchAuthorization: { kind: "workspace" },
  async execute(tx, ctx, envelope, payload) {
    const bands = await loadApprovalBands(tx, ctx.workspaceId);
    checkOptimisticVersion(envelope, bands.version);

    const problem = thresholdBandsProblem(payload);
    if (problem !== undefined) throw new CommandError(422, problem);

    const first = bands.rows[0];
    if (bands.recordingThresholdMinor === null || bands.financeCeilingMinor === null || !first) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND");
    }

    const recording = BigInt(payload.recordingThresholdMinor);
    const ceiling = BigInt(payload.financeCeilingMinor);
    const target = (commandType: string) =>
      (RECORDING_BAND_TYPES as readonly string[]).includes(commandType) ? recording : ceiling;

    const moved = bands.rows.filter((rule) => rule.amountMaxMinor !== target(rule.commandType));
    if (moved.length === 0) return { recordId: first.id, rowVersion: first.rowVersion };

    for (const rule of moved) {
      const [updated] = await tx
        .update(approvalRules)
        .set({ amountMaxMinor: target(rule.commandType), rowVersion: rule.rowVersion + 1 })
        .where(eq(approvalRules.id, rule.id))
        .returning();
      if (!updated) throw new Error("approval_rules update returned no row");
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "approval-threshold.updated",
      entityType: "approval_rule",
      entityId: first.id,
      beforeState: {
        recordingThresholdMinor: bands.recordingThresholdMinor.toString(),
        financeCeilingMinor: bands.financeCeilingMinor.toString(),
      },
      afterState: {
        recordingThresholdMinor: recording.toString(),
        financeCeilingMinor: ceiling.toString(),
      },
      changedFields: [
        ...(bands.recordingThresholdMinor !== recording ? ["recordingThresholdMinor"] : []),
        ...(bands.financeCeilingMinor !== ceiling ? ["financeCeilingMinor"] : []),
      ],
    });
    await recordApprovalRuleChange(tx, ctx, envelope.commandId, [
      ...new Set(moved.map((rule) => rule.commandType)),
    ]);

    const movedFirst = moved.find((rule) => rule.id === first.id);
    return { recordId: first.id, rowVersion: first.rowVersion + (movedFirst ? 1 : 0) };
  },
};

registerCommand(updateApprovalThresholdV2);
