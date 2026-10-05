import { attachEvidencePayload, type AttachEvidencePayload } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { financialEntries } from "../db/schema.js";
import { EVIDENCE_ATTACHED_EVENT, hasPostingWithoutWorkOrder } from "../reads/entry-evidence.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { assertOwnRecord } from "./own-records.js";

/**
 * Files for an entry that already exists — the receipt that turned up after the
 * expense was recorded. Nothing on the entry changes: no amount, no status, no
 * version, so neither `expectedVersion` nor the period lock (§4.3 covers
 * postings) applies. The link is the dispatcher's own `command_source_artifacts`
 * row for this call, and the audit event is how reads find it.
 *
 * Who may attach is who may record an expense: anyone who could have attached
 * the file at capture. The workshop, which records only work-order costs,
 * attaches only to entries whose every line carries a work order. TECHNICIAN
 * and DRIVER attach only to entries they recorded themselves
 * (docs/reference/roles-and-access.md, "own").
 */
export const attachEvidence: CommandDefinition<AttachEvidencePayload> = {
  name: "attach-evidence",
  version: 1,
  module: "FINANCE",
  allowedRoles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
  payloadSchema: attachEvidencePayload,
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
      // A missing entry resolves to no branch, so the handler can answer
      // REFERENCE_NOT_FOUND with the id rather than scope answering 403.
      return entry ? [entry.branchId] : [];
    },
  },

  async execute(tx, ctx, envelope, payload) {
    const [entry] = await tx
      .select({
        id: financialEntries.id,
        status: financialEntries.status,
        reversesEntryId: financialEntries.reversesEntryId,
        rowVersion: financialEntries.rowVersion,
        createdByCommandId: financialEntries.createdByCommandId,
      })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, ctx.workspaceId),
          eq(financialEntries.id, payload.entryId),
        ),
      )
      .limit(1);
    if (!entry) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "financialEntry",
        referenceId: payload.entryId,
      });
    }

    const linked = new Set(envelope.sourceArtifactIds);
    if (
      linked.size !== payload.artifactIds.length ||
      payload.artifactIds.some((artifactId) => !linked.has(artifactId))
    ) {
      throw new CommandError(400, "VALIDATION_FAILED", {
        issues: [{ code: "custom", path: ["artifactIds"] }],
      });
    }

    // A refused spend never happened, and a reversal cancels one: neither has
    // paperwork of its own to complete.
    if (entry.status === "REJECTED" || entry.reversesEntryId !== null) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        entityType: "financial_entry",
        status: entry.status,
        reason: "not_attachable",
      });
    }

    if (ctx.role === "TECHNICIAN") {
      if (await hasPostingWithoutWorkOrder(tx, ctx.workspaceId, entry.id)) {
        throw new CommandError(403, "ROLE_FORBIDDEN", {
          command: "attach-evidence",
          reason: "WORK_ORDER_REQUIRED",
        });
      }
    }
    await assertOwnRecord(tx, ctx, ["TECHNICIAN", "DRIVER"], {
      entityType: "financial_entry",
      id: entry.id,
      createdByCommandId: entry.createdByCommandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: EVIDENCE_ATTACHED_EVENT,
      entityType: "financial_entry",
      entityId: entry.id,
      afterState: { artifactIds: payload.artifactIds },
      changedFields: ["artifactIds"],
    });

    return { recordId: entry.id, rowVersion: entry.rowVersion, recordStatus: entry.status };
  },
};

registerCommand(attachEvidence);
