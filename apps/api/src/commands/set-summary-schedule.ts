import {
  DEFAULT_SUMMARY_SCHEDULE,
  setSummarySchedulePayload,
  type SetSummarySchedulePayload,
} from "@routiq/contracts";
import { and, eq, sql } from "drizzle-orm";
import { companySettings } from "../db/schema.js";
import {
  appendAuditEvent,
  appendNoChangeAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";

/**
 * Company settings › Dashboard summary (#669): when the summary notice shows
 * on every Overview. Direction's, like every company setting (ADR-0009). The
 * workspace has no row until the first change, and its version is 0 until
 * then; the first change inserts the row at version 1. Choosing the schedule
 * already in force writes nothing but the command.no_change event (#153).
 */
const setSummarySchedule: CommandDefinition<SetSummarySchedulePayload> = {
  name: "set-summary-schedule",
  version: 1,
  module: "CORE",
  allowedRoles: ["DIRECTOR"],
  payloadSchema: setSummarySchedulePayload,
  branchAuthorization: { kind: "workspace" },
  async execute(tx, ctx, envelope, payload) {
    const [current] = await tx
      .select({ summarySchedule: companySettings.summarySchedule, rowVersion: companySettings.rowVersion })
      .from(companySettings)
      .where(eq(companySettings.workspaceId, ctx.workspaceId))
      .for("update");
    const version = current?.rowVersion ?? 0;
    checkOptimisticVersion(envelope, version);

    const before = current?.summarySchedule ?? DEFAULT_SUMMARY_SCHEDULE;
    if (before === payload.schedule) {
      await appendNoChangeAuditEvent(tx, ctx, envelope, { summarySchedule: payload.schedule });
      return { recordId: ctx.workspaceId, rowVersion: version };
    }

    const [written] =
      current === undefined
        ? await tx
            .insert(companySettings)
            .values({
              workspaceId: ctx.workspaceId,
              summarySchedule: payload.schedule,
              createdByCommandId: envelope.commandId,
              updatedByCommandId: envelope.commandId,
            })
            // A first change committed by someone else since the read above.
            .onConflictDoNothing()
            .returning({ rowVersion: companySettings.rowVersion })
        : await tx
            .update(companySettings)
            .set({
              summarySchedule: payload.schedule,
              updatedByCommandId: envelope.commandId,
              updatedAt: sql`now()`,
              rowVersion: version + 1,
            })
            .where(and(eq(companySettings.workspaceId, ctx.workspaceId), eq(companySettings.rowVersion, version)))
            .returning({ rowVersion: companySettings.rowVersion });
    if (written === undefined) {
      throw new CommandError(409, "VERSION_CONFLICT", { expectedVersion: version, currentVersion: version + 1 });
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "company-settings.summary-schedule-changed",
      entityType: "company_settings",
      entityId: ctx.workspaceId,
      beforeState: { summarySchedule: before },
      afterState: { summarySchedule: payload.schedule },
      changedFields: ["summarySchedule"],
    });
    return { recordId: ctx.workspaceId, rowVersion: written.rowVersion };
  },
};

registerCommand(setSummarySchedule);
