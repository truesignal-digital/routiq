import { noteDetail, type AssetAttentionItem } from "@routiq/contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { noteAcknowledgements, notes } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { commandActors } from "./actors.js";
import { loadScopedAsset } from "./asset-scope.js";
import { ANY_ROLE, defineRead } from "./define-read.js";
import { invalidRequest, notFound, sendReadFailure } from "./read-gate.js";

const clip = (text: string): string => (text.length > 140 ? `${text.slice(0, 139)}…` : text);

/**
 * The notes Direction left on this vehicle that nobody has acknowledged (#98),
 * as To-do items. The caller already passed the vehicle's branch scope, so
 * whoever sees the vehicle sees its Direction notes. The author is the one
 * member who may not acknowledge.
 */
export async function directionNoteItems(
  tx: TenantTx,
  auth: AuthContext,
  assetId: string,
): Promise<AssetAttentionItem[]> {
  const rows = await tx
    .select({
      id: notes.id,
      body: notes.body,
      createdAt: notes.createdAt,
      createdByCommandId: notes.createdByCommandId,
    })
    .from(notes)
    .leftJoin(
      noteAcknowledgements,
      and(
        eq(noteAcknowledgements.workspaceId, notes.workspaceId),
        eq(noteAcknowledgements.noteId, notes.id),
      ),
    )
    .where(
      and(
        eq(notes.workspaceId, auth.workspaceId),
        eq(notes.assetId, assetId),
        eq(notes.authorRole, "DIRECTOR"),
        isNull(noteAcknowledgements.id),
      ),
    );
  const authors = await commandActors(
    tx,
    auth.workspaceId,
    rows.map((row) => row.createdByCommandId),
  );
  return rows.map((row) => {
    const author = authors.get(row.createdByCommandId);
    return {
      code: "DIRECTION_NOTE",
      severity: "INFO",
      subject: { entityType: "note", id: row.id, number: null, rowVersion: null },
      since: row.createdAt.toISOString(),
      partOfGrounding: false,
      makerPrincipalIds: author?.principalId ? [author.principalId] : [],
      params: {
        description: clip(row.body),
        ...(author === undefined ? {} : { recordedBy: author }),
      },
    } satisfies AssetAttentionItem;
  });
}

export function registerNoteReadRoutes(app: FastifyInstance, db: Db, requireAuth: RequireAuth) {
  /**
   * One note, read against the vehicle it is on: a member outside the
   * vehicle's branches gets 404, as for the vehicle itself. CORE, like
   * add-note: every member may read the notes on what they can see.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/notes/:noteId", module: "CORE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const params = z.object({ noteId: z.uuid() }).safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { noteId } = params.data;

        const body = await read(async (tx) => {
          const [row] = await tx
            .select({
              id: notes.id,
              assetId: notes.assetId,
              body: notes.body,
              authorRole: notes.authorRole,
              createdAt: notes.createdAt,
              createdByCommandId: notes.createdByCommandId,
              acknowledgedAt: noteAcknowledgements.createdAt,
              acknowledgedByCommandId: noteAcknowledgements.createdByCommandId,
            })
            .from(notes)
            .leftJoin(
              noteAcknowledgements,
              and(
                eq(noteAcknowledgements.workspaceId, notes.workspaceId),
                eq(noteAcknowledgements.noteId, notes.id),
              ),
            )
            .where(and(eq(notes.workspaceId, auth.workspaceId), eq(notes.id, noteId)))
            .limit(1);
          if (!row || row.assetId === null) throw notFound();
          if ((await loadScopedAsset(tx, auth, row.assetId)) === undefined) throw notFound();

          const actors = await commandActors(tx, auth.workspaceId, [
            row.createdByCommandId,
            ...(row.acknowledgedByCommandId === null ? [] : [row.acknowledgedByCommandId]),
          ]);
          const unknown = { principalId: null, displayName: null, scope: "WORKSPACE" as const };
          return {
            id: row.id,
            assetId: row.assetId,
            body: row.body,
            author: actors.get(row.createdByCommandId) ?? unknown,
            authorRole: row.authorRole,
            createdAt: row.createdAt.toISOString(),
            acknowledgement:
              row.acknowledgedAt === null || row.acknowledgedByCommandId === null
                ? null
                : {
                    by: actors.get(row.acknowledgedByCommandId) ?? unknown,
                    at: row.acknowledgedAt.toISOString(),
                  },
          };
        });
        return noteDetail.parse(body);
      } catch (error) {
        return sendReadFailure(req, reply, error, "note detail");
      }
    },
  );
}
