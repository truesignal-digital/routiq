import {
  assetReadingsQuery,
  assetReadingsResponse,
  type ListSort,
} from "@routiq/contracts";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { activities, commands, meterReadings, principals } from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { toActor } from "./actors.js";
import { requireScopedAsset } from "./asset-scope.js";
import {
  afterKeyset,
  decodeTimestampCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  microsecondKey,
  timestampKeyset,
} from "./cursor.js";
import { invalidRequest, passReadGate, sendReadFailure } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";

const readingSort: ListSort<"observedAt"> = { field: "observedAt", direction: "desc" };

const observedAtColumn = timestampKeyset(meterReadings.observedAt);

/**
 * Which of an in-scope vehicle's readings the caller may see, by the history
 * read's rule (#58): a reading taken during a job belongs to the job's branch,
 * a standalone one to the vehicle's — already checked by the caller. Undefined
 * when the caller holds every branch.
 */
export function readingBranchScope(auth: AuthContext): SQL | undefined {
  if (auth.branchScope === "ALL") return undefined;
  return or(
    isNull(meterReadings.activityId),
    sql`exists (
      select 1 from ${activities}
      where ${activities.workspaceId} = ${meterReadings.workspaceId}
        and ${activities.id} = ${meterReadings.activityId}
        and ${inArray(activities.branchId, auth.branchScope)}
    )`,
  );
}

export function registerAssetReadingReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * Every observation of the vehicle's meters, superseded ones included and
   * flagged. Owned by ACTIVITIES, the module whose command records them.
   */
  app.get(
    "/v1/assets/:assetId/readings",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const params = z.object({ assetId: z.uuid() }).safeParse(req.params);
        const query = assetReadingsQuery.safeParse(req.query);
        if (!params.success || !query.success) throw invalidRequest();
        const { assetId } = params.data;
        const { readingType, cursor, limit } = query.data;

        const decodedCursor = cursor ? decodeTimestampCursor(cursor, readingSort) : undefined;
        if (cursor && !decodedCursor) throw invalidRequest();

        const rows = await inWorkspace(db, auth.workspaceId, async (tx) => {
          await passReadGate(tx, auth, { module: "ACTIVITIES" });
          await requireScopedAsset(tx, auth, assetId);

          const conditions: SQL[] = [
            eq(meterReadings.workspaceId, auth.workspaceId),
            eq(meterReadings.assetId, assetId),
          ];
          const scope = readingBranchScope(auth);
          if (scope) conditions.push(scope);
          if (readingType) conditions.push(eq(meterReadings.readingType, readingType));
          if (decodedCursor) {
            conditions.push(
              afterKeyset(observedAtColumn, readingSort.direction, meterReadings.id, decodedCursor),
            );
          }

          return tx
            .select({
              id: meterReadings.id,
              readingType: meterReadings.readingType,
              value: meterReadings.value,
              observedAt: meterReadings.observedAt,
              observedAtKey: microsecondKey(meterReadings.observedAt),
              source: meterReadings.source,
              activityId: meterReadings.activityId,
              activityNumber: activities.activityNumber,
              supersededById: meterReadings.supersededById,
              supersedeReason: meterReadings.supersedeReason,
              origin: commands.origin,
              principalId: commands.tenantActorPrincipalId,
              displayName: principals.displayName,
              scope: commands.scope,
            })
            .from(meterReadings)
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, meterReadings.workspaceId),
                eq(commands.id, meterReadings.createdByCommandId),
              ),
            )
            .leftJoin(
              activities,
              and(
                eq(activities.workspaceId, meterReadings.workspaceId),
                eq(activities.id, meterReadings.activityId),
              ),
            )
            .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
            .where(and(...conditions))
            .orderBy(...keysetOrderBy(observedAtColumn, readingSort.direction, meterReadings.id))
            .limit(limit + 1);
        });

        const pageRows = rows.slice(0, limit);
        const last = pageRows[pageRows.length - 1];
        const nextCursor =
          rows.length > limit && last
            ? encodeKeysetCursor(readingSort, last.observedAtKey, last.id)
            : null;

        return assetReadingsResponse.parse({
          items: pageRows.map((row) => ({
            id: row.id,
            readingType: row.readingType,
            value: serializeMinor(row.value),
            observedAt: row.observedAt.toISOString(),
            source: row.source,
            activityId: row.activityId,
            activityNumber: row.activityNumber,
            supersededById: row.supersededById,
            supersedeReason: row.supersedeReason,
            recordedBy: toActor(row),
            origin: row.origin,
          })),
          nextCursor,
        });
      } catch (error) {
        return sendReadFailure(req, reply, error, "asset readings");
      }
    },
  );
}
