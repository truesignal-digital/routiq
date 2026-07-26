import { lockPeriodPayload, reopenPeriodPayload } from "@routiq/contracts";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { financialEntries, postingPeriods } from "../db/schema.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
} from "./dispatcher.js";
import { ensurePeriod } from "./periods.js";

type LockPeriodPayload = z.infer<typeof lockPeriodPayload>;
type ReopenPeriodPayload = z.infer<typeof reopenPeriodPayload>;

function nextPeriodStart(periodCode: string): string {
  const year = Number(periodCode.slice(0, 4));
  const month = Number(periodCode.slice(5, 7));
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

registerCommand<LockPeriodPayload>({
  name: "lock-period",
  version: 1,
  module: "FINANCE",
  allowedRoles: ["FINANCE_APPROVER", "ADMIN"],
  payloadSchema: lockPeriodPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    let [period] = await tx
      .select({
        id: postingPeriods.id,
        status: postingPeriods.status,
        lockedAt: postingPeriods.lockedAt,
        lockedByCommandId: postingPeriods.lockedByCommandId,
        rowVersion: postingPeriods.rowVersion,
      })
      .from(postingPeriods)
      .where(
        and(
          eq(postingPeriods.workspaceId, ctx.workspaceId),
          eq(postingPeriods.periodCode, payload.periodCode),
        ),
      )
      .for("update")
      .limit(1);

    if (period) {
      // An existing row (auto-created by posting, or a reopened month) is a
      // mutation of shared state — §5.3 optimistic concurrency applies. A
      // fresh lock of an untouched month has no row to version-check.
      checkOptimisticVersion(envelope, period.rowVersion);
      if (period.status === "LOCKED") {
        throw new CommandError(409, "INVALID_STATE_TRANSITION", {
          from: "LOCKED",
          to: "LOCKED",
        });
      }
    }

    if (!period) {
      const ensured = await ensurePeriod(
        tx,
        ctx,
        payload.periodCode,
        envelope.commandId,
      );
      if (ensured.status === "LOCKED") {
        throw new CommandError(409, "INVALID_STATE_TRANSITION", {
          from: "LOCKED",
          to: "LOCKED",
        });
      }
      period = {
        ...ensured,
        lockedAt: null,
        lockedByCommandId: null,
      };
    }

    const periodStart = `${payload.periodCode}-01`;
    const [submitted] = await tx
      .select({ count: sql<number>`count(*)::integer` })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, ctx.workspaceId),
          eq(financialEntries.status, "SUBMITTED"),
          gte(financialEntries.economicDate, periodStart),
          lt(financialEntries.economicDate, nextPeriodStart(payload.periodCode)),
        ),
      );

    const lockedAt = new Date();
    const rowVersion = period.rowVersion + 1;

    await tx
      .update(postingPeriods)
      .set({
        status: "LOCKED",
        lockedAt,
        lockedByCommandId: envelope.commandId,
        rowVersion,
      })
      .where(
        and(
          eq(postingPeriods.workspaceId, ctx.workspaceId),
          eq(postingPeriods.id, period.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "posting_period.locked",
      entityType: "posting_period",
      entityId: period.id,
      beforeState: {
        status: "OPEN",
        lockedAt: period.lockedAt,
        lockedByCommandId: period.lockedByCommandId,
        rowVersion: period.rowVersion,
      },
      afterState: {
        status: "LOCKED",
        lockedAt: lockedAt.toISOString(),
        lockedByCommandId: envelope.commandId,
        rowVersion,
      },
      changedFields: [
        "status",
        "lockedAt",
        "lockedByCommandId",
        "rowVersion",
      ],
    });

    const warnings =
      (submitted?.count ?? 0) > 0
        ? (["PERIOD_HAS_SUBMITTED_ENTRIES"] as const)
        : [];

    return {
      recordId: period.id,
      rowVersion,
      recordStatus: "LOCKED",
      warnings: [...warnings],
    };
  },
});

registerCommand<ReopenPeriodPayload>({
  name: "reopen-period",
  version: 1,
  module: "FINANCE",
  allowedRoles: ["FINANCE_APPROVER", "ADMIN"],
  payloadSchema: reopenPeriodPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const [period] = await tx
      .select()
      .from(postingPeriods)
      .where(
        and(
          eq(postingPeriods.workspaceId, ctx.workspaceId),
          eq(postingPeriods.periodCode, payload.periodCode),
        ),
      )
      .for("update")
      .limit(1);

    if (!period) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "postingPeriod",
        referenceCode: payload.periodCode,
      });
    }

    checkOptimisticVersion(envelope, period.rowVersion);

    if (period.status !== "LOCKED") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: period.status,
        to: "OPEN",
      });
    }

    const rowVersion = period.rowVersion + 1;

    await tx
      .update(postingPeriods)
      .set({
        status: "OPEN",
        lockedAt: null,
        lockedByCommandId: null,
        rowVersion,
      })
      .where(
        and(
          eq(postingPeriods.workspaceId, ctx.workspaceId),
          eq(postingPeriods.id, period.id),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "posting_period.reopened",
      entityType: "posting_period",
      entityId: period.id,
      beforeState: {
        status: "LOCKED",
        lockedAt: period.lockedAt?.toISOString() ?? null,
        lockedByCommandId: period.lockedByCommandId,
        rowVersion: period.rowVersion,
      },
      afterState: {
        status: "OPEN",
        lockedAt: null,
        lockedByCommandId: null,
        rowVersion,
        reason: payload.reason,
      },
      changedFields: [
        "status",
        "lockedAt",
        "lockedByCommandId",
        "rowVersion",
      ],
    });

    return {
      recordId: period.id,
      rowVersion,
      recordStatus: "OPEN",
      warnings: [],
    };
  },
});
