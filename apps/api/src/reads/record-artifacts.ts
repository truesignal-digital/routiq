import type { RecordArtifact } from "@routiq/contracts";
import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import { commandSourceArtifacts, sourceArtifacts } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { notFound } from "./read-gate.js";

/**
 * A record's attachments are the files of the command that wrote it
 * (`command_source_artifacts`), so a read lists them by the record's
 * `created_by_command_id`. Oldest first, per command.
 */
export async function commandArtifacts(
  tx: TenantTx,
  workspaceId: string,
  commandIds: readonly string[],
): Promise<Map<string, RecordArtifact[]>> {
  const byCommand = new Map<string, RecordArtifact[]>();
  if (commandIds.length === 0) return byCommand;
  const rows = await tx
    .select({
      commandId: commandSourceArtifacts.commandId,
      artifactId: sourceArtifacts.id,
      mimeType: sourceArtifacts.mimeType,
      sizeBytes: sourceArtifacts.sizeBytes,
      originalFileName: sourceArtifacts.originalFileName,
    })
    .from(commandSourceArtifacts)
    .innerJoin(
      sourceArtifacts,
      and(
        eq(sourceArtifacts.workspaceId, commandSourceArtifacts.workspaceId),
        eq(sourceArtifacts.id, commandSourceArtifacts.artifactId),
      ),
    )
    .where(
      and(
        eq(commandSourceArtifacts.workspaceId, workspaceId),
        inArray(commandSourceArtifacts.commandId, [...new Set(commandIds)]),
      ),
    )
    .orderBy(asc(sourceArtifacts.createdAt), asc(sourceArtifacts.id));
  for (const row of rows) {
    const files = byCommand.get(row.commandId) ?? [];
    files.push({
      artifactId: row.artifactId,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      originalFileName: row.originalFileName,
    });
    byCommand.set(row.commandId, files);
  }
  return byCommand;
}

/**
 * The stored file, only when `commandId` linked it — the check a record-scoped
 * download makes after authorizing the record. Any miss is the same 404.
 */
export async function linkedArtifact(
  tx: TenantTx,
  workspaceId: string,
  commandId: string,
  artifactId: string,
): Promise<typeof sourceArtifacts.$inferSelect> {
  const [row] = await tx
    .select()
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.workspaceId, workspaceId),
        eq(sourceArtifacts.id, artifactId),
        exists(
          tx
            .select({ one: sql`1` })
            .from(commandSourceArtifacts)
            .where(
              and(
                eq(commandSourceArtifacts.workspaceId, workspaceId),
                eq(commandSourceArtifacts.commandId, commandId),
                eq(commandSourceArtifacts.artifactId, artifactId),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}
