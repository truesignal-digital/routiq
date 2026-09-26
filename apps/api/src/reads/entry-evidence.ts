import type { EntryEvidenceFile } from "@routiq/contracts";
import { REFERENCE_PAYMENT_METHODS } from "@routiq/domain";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  auditEvents,
  categories,
  commandSourceArtifacts,
  commands,
  financialEntries,
  principals,
  sourceArtifacts,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { toActor } from "./actors.js";

/**
 * An entry's evidence, read without a link table (PLAN §1.7): the files of the
 * command that recorded it, plus those of every `attach-evidence` call — found
 * through its audit event, whose `command_id` is the call's receipt. Both walks
 * are indexed (the audit index; `command_artifacts_uq` on command then file).
 *
 * The SQL here mirrors `entryEvidenceState` in @routiq/domain for WHERE clauses;
 * selects compute the state in TypeScript from `entryArtifactCountSql` so the
 * rule is written once where it can be. entry-evidence.test.ts holds the pair
 * together. Every fragment correlates on the unaliased `financial_entries`.
 */

export const EVIDENCE_ATTACHED_EVENT = "financial_entry.evidence_attached";

/** The receipts of every `attach-evidence` call on the outer entry. */
function attachCommandIdsSql(): SQL {
  return sql`select ${auditEvents.commandId} from ${auditEvents}
    where ${auditEvents.workspaceId} = ${financialEntries.workspaceId}
      and ${auditEvents.entityType} = 'financial_entry'
      and ${auditEvents.entityId} = ${financialEntries.id}
      and ${auditEvents.eventType} = ${EVIDENCE_ATTACHED_EVENT}`;
}

/** Distinct files linked to the outer entry. */
export function entryArtifactCountSql(): SQL<number> {
  return sql<number>`(
    select count(distinct ${commandSourceArtifacts.artifactId})::int
    from ${commandSourceArtifacts}
    where ${commandSourceArtifacts.workspaceId} = ${financialEntries.workspaceId}
      and (
        ${commandSourceArtifacts.commandId} = ${financialEntries.createdByCommandId}
        or ${commandSourceArtifacts.commandId} in (${attachCommandIdsSql()})
      )
  )`;
}

/** The outer entry's category evidence policy, whatever the query joined. */
function evidencePolicySql(): SQL {
  return sql`(
    select ${categories.evidencePolicy} from ${categories}
    where ${categories.workspaceId} = ${financialEntries.workspaceId}
      and ${categories.id} = ${financialEntries.categoryId}
  )`;
}

/** `entryEvidenceState` as a SQL expression over the outer entry. */
export function entryEvidenceStateSql(): SQL<string> {
  return sql<string>`case
    when ${entryArtifactCountSql()} >= 1 then 'SUPPLIED'
    when ${evidencePolicySql()} = 'NO_RECEIPT_EXPECTED' then 'NOT_EXPECTED'
    when ${inArray(financialEntries.paymentMethod, [...REFERENCE_PAYMENT_METHODS])}
      and ${financialEntries.paymentReference} is not null then 'PAYMENT_REFERENCE'
    else 'NOT_SUPPLIED'
  end`;
}

/**
 * Still waiting for paperwork: NOT_SUPPLIED, and not a reversal — a reversal
 * cancels a spend and needs no receipt of its own.
 */
export function entryEvidenceMissingSql(): SQL {
  return sql`(${entryEvidenceStateSql()} = 'NOT_SUPPLIED' and ${financialEntries.reversesEntryId} is null)`;
}

/**
 * The files behind one entry, oldest first, each once: a file linked by both
 * the recording call and a later attach keeps its first appearance.
 */
export async function entryEvidenceFiles(
  tx: TenantTx,
  workspaceId: string,
  entry: { id: string; createdByCommandId: string },
): Promise<EntryEvidenceFile[]> {
  const attachCalls = tx
    .select({ commandId: auditEvents.commandId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, workspaceId),
        eq(auditEvents.entityType, "financial_entry"),
        eq(auditEvents.entityId, entry.id),
        eq(auditEvents.eventType, EVIDENCE_ATTACHED_EVENT),
      ),
    );

  const rows = await tx
    .select({
      artifactId: commandSourceArtifacts.artifactId,
      commandId: commandSourceArtifacts.commandId,
      mimeType: sourceArtifacts.mimeType,
      sizeBytes: sourceArtifacts.sizeBytes,
      originalFileName: sourceArtifacts.originalFileName,
      sha256: sourceArtifacts.sha256,
      attachedAt: commands.executedAt,
      principalId: commands.tenantActorPrincipalId,
      displayName: principals.displayName,
      scope: commands.scope,
    })
    .from(commandSourceArtifacts)
    .innerJoin(
      sourceArtifacts,
      and(
        eq(sourceArtifacts.workspaceId, commandSourceArtifacts.workspaceId),
        eq(sourceArtifacts.id, commandSourceArtifacts.artifactId),
      ),
    )
    .innerJoin(
      commands,
      and(
        eq(commands.workspaceId, commandSourceArtifacts.workspaceId),
        eq(commands.id, commandSourceArtifacts.commandId),
      ),
    )
    .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
    .where(
      and(
        eq(commandSourceArtifacts.workspaceId, workspaceId),
        or(
          eq(commandSourceArtifacts.commandId, entry.createdByCommandId),
          inArray(commandSourceArtifacts.commandId, attachCalls),
        ),
      ),
    )
    .orderBy(asc(commands.executedAt), asc(commandSourceArtifacts.artifactId));

  const seen = new Set<string>();
  const files: EntryEvidenceFile[] = [];
  for (const row of rows) {
    if (seen.has(row.artifactId)) continue;
    seen.add(row.artifactId);
    files.push({
      artifactId: row.artifactId,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      originalFileName: row.originalFileName,
      sha256: row.sha256,
      attachedAt: row.attachedAt.toISOString(),
      attachedBy: toActor(row),
      via: row.commandId === entry.createdByCommandId ? "RECORDED" : "ATTACHED",
    });
  }
  return files;
}
