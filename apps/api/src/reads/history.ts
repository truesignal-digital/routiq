import {
  HISTORY_ENTITY_MODULE,
  historyEntityType,
  historyListQuery,
  historyListResponse,
  type ListSort,
} from "@routiq/contracts";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { auditEvents, commands, principals } from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { isModuleEnabled } from "../modules/registry.js";
import {
  afterKeyset,
  bindTimestamp,
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  type KeysetColumn,
} from "./cursor.js";

/**
 * Newest first, always. A timeline has one meaningful order, so the sort is not
 * a client choice — but the cursor still carries it, because `decodeKeysetCursor`
 * refuses a boundary minted under any other ordering.
 */
const historySort: ListSort<"occurredAt"> = {
  field: "occurredAt",
  direction: "desc",
};

const occurredAtColumn: KeysetColumn = {
  column: auditEvents.occurredAt,
  bind: bindTimestamp,
};

/**
 * State keys that may surface as the timeline's `note` — an allowlist, never a
 * passthrough. `after_state` is a row snapshot: future user-management events
 * will put credential material in there, and nothing reaches a client from it
 * except a key named here.
 */
const NOTE_STATE_KEYS = ["reason"] as const;

/**
 * The first allowlisted key holding a JSON string. The `jsonb_typeof` guard
 * matters: `->>` would happily serialise an object into the note line.
 */
function noteSql(): SQL<string | null> {
  const candidates = NOTE_STATE_KEYS.map(
    (key) =>
      sql`case when jsonb_typeof(${auditEvents.afterState} -> ${key}::text) = 'string'
               then ${auditEvents.afterState} ->> ${key}::text end`,
  );
  return sql<string | null>`coalesce(${sql.join(candidates, sql`, `)}, null)`;
}

export function registerHistoryReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * History is visible to whoever can read the record: the gate is the owning
   * module's entitlement plus RLS, with no per-role rule on top. Field staff
   * seeing "the office corrected my sheet" is the point, not a leak.
   */
  app.get(
    "/v1/history/:entityType/:entityId",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedParams = z
          .object({ entityType: historyEntityType, entityId: z.uuid() })
          .safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { entityType, entityId } = parsedParams.data;

        const parsedQuery = historyListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { cursor, limit } = parsedQuery.data;

        const moduleCode = HISTORY_ENTITY_MODULE[entityType];

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          if (!(await isModuleEnabled(tx, auth.workspaceId, moduleCode))) {
            return { error: "MODULE_DISABLED" as const };
          }

          const decodedCursor = cursor
            ? decodeKeysetCursor(cursor, historySort)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          const conditions: SQL[] = [
            eq(auditEvents.workspaceId, auth.workspaceId),
            eq(auditEvents.entityType, entityType),
            eq(auditEvents.entityId, entityId),
          ];
          if (decodedCursor) {
            conditions.push(
              afterKeyset(
                occurredAtColumn,
                historySort.direction,
                auditEvents.id,
                decodedCursor,
              ),
            );
          }

          const rows = await tx
            .select({
              eventId: auditEvents.id,
              eventType: auditEvents.eventType,
              occurredAt: auditEvents.occurredAt,
              scope: auditEvents.scope,
              // The generated masking column, not `actor_principal_id`: it is
              // NULL for PLATFORM events, so the principals join finds nothing
              // and the vendor operator's identity never crosses the tenant line.
              actorPrincipalId: auditEvents.tenantActorPrincipalId,
              actorDisplayName: principals.displayName,
              commandId: commands.id,
              commandName: commands.commandType,
              commandVersion: commands.commandVersion,
              origin: commands.origin,
              clientOccurredAt: commands.clientOccurredAt,
              changedFields: auditEvents.changedFields,
              note: noteSql(),
            })
            .from(auditEvents)
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, auditEvents.workspaceId),
                eq(commands.id, auditEvents.commandId),
              ),
            )
            .leftJoin(
              principals,
              eq(principals.id, auditEvents.tenantActorPrincipalId),
            )
            .where(and(...conditions))
            .orderBy(
              ...keysetOrderBy(
                occurredAtColumn,
                historySort.direction,
                auditEvents.id,
              ),
            )
            .limit(limit + 1);

          return { rows };
        });

        if ("error" in result) {
          return result.error === "MODULE_DISABLED"
            ? reply.status(403).send({
                error: { code: "MODULE_DISABLED", metadata: { module: moduleCode } },
              })
            : reply.status(400).send({ error: { code: result.error } });
        }

        const hasNextPage = result.rows.length > limit;
        const pageRows = result.rows.slice(0, limit);
        const items = pageRows.map((row) => ({
          eventId: row.eventId,
          eventType: row.eventType,
          occurredAt: row.occurredAt.toISOString(),
          actor: {
            principalId: row.actorPrincipalId,
            displayName: row.actorDisplayName,
            scope: row.scope,
          },
          command: {
            id: row.commandId,
            name: row.commandName,
            version: row.commandVersion,
            origin: row.origin,
            clientOccurredAt: row.clientOccurredAt?.toISOString() ?? null,
          },
          changedFields: row.changedFields ?? [],
          note: row.note,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(
            historySort,
            lastRow.occurredAt.toISOString(),
            lastRow.eventId,
          );
        }

        return historyListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "record history read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
