import {
  listQuery,
  memberListResponse,
  memberListSortFields,
  type ListSort,
  type MemberListSortField,
  type MemberStatus,
} from "@routiq/contracts";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { credentials, memberships, principals } from "../db/schema.js";
import {
  afterKeyset,
  bindText,
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  type KeysetColumn,
} from "./cursor.js";
import { ADMIN_ONLY, defineRead } from "./define-read.js";

const listQuerySchema = listQuery(
  {
    /**
     * Off by default: the screen shows who works here, and a former employee
     * is one toggle away rather than mixed into the everyday list. The list is
     * still where reactivation happens, so hiding them can never be permanent.
     */
    includeDeactivated: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  },
  { sortFields: memberListSortFields },
);

const defaultMemberSort: ListSort<MemberListSortField> = {
  field: "displayName",
  direction: "asc",
};

const memberSortColumns: Record<MemberListSortField, KeysetColumn> = {
  displayName: { column: principals.displayName, bind: bindText },
};

/**
 * The Users screen, as one query. Membership is the spine — a workspace's
 * people are its memberships — with the principal supplying the name and the
 * credential the login, left-joined because a member may hold no credential.
 *
 * ADMIN-only, matching the commands the screen sends: usernames and lockout
 * state are administrative facts, not directory information every role reads.
 */
export function registerMemberReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/members", module: "CORE", roles: ADMIN_ONLY, branchScope: "workspace" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = listQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { includeDeactivated, cursor, limit } = parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultMemberSort;
        const sortColumn = memberSortColumns[sort.field];

        const decodedCursor = cursor ? decodeKeysetCursor(cursor, sort) : undefined;
        if (cursor && !decodedCursor) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }

        const conditions: SQL[] = [eq(memberships.workspaceId, auth.workspaceId)];
        if (!includeDeactivated) {
          conditions.push(isNull(memberships.deactivatedAt));
        }
        if (decodedCursor) {
          conditions.push(
            afterKeyset(sortColumn, sort.direction, memberships.principalId, decodedCursor),
          );
        }

        const rows = await read((tx) =>
          tx
            .select({
              principalId: memberships.principalId,
              displayName: principals.displayName,
              username: credentials.username,
              role: memberships.role,
              allBranches: memberships.allBranches,
              branchIds: memberships.branchIds,
              deactivatedAt: memberships.deactivatedAt,
              lockedUntil: credentials.lockedUntil,
              rowVersion: memberships.rowVersion,
              createdAt: memberships.createdAt,
            })
            .from(memberships)
            .innerJoin(principals, eq(principals.id, memberships.principalId))
            .leftJoin(
              credentials,
              and(
                eq(credentials.workspaceId, memberships.workspaceId),
                eq(credentials.principalId, memberships.principalId),
              ),
            )
            .where(and(...conditions))
            .orderBy(...keysetOrderBy(sortColumn, sort.direction, memberships.principalId))
            // One extra row is the has-next probe, never returned.
            .limit(limit + 1),
        );

        const hasNextPage = rows.length > limit;
        const now = Date.now();
        const items = rows.slice(0, limit).map((row) => ({
          principalId: row.principalId,
          displayName: row.displayName,
          username: row.username,
          role: row.role,
          branchScope: row.allBranches ? ("ALL" as const) : row.branchIds,
          status: memberStatusOf(row.deactivatedAt, row.lockedUntil, now),
          rowVersion: row.rowVersion,
          createdAt: row.createdAt.toISOString(),
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && items.length > 0) {
          const last = items[items.length - 1]!;
          nextCursor = encodeKeysetCursor(sort, last.displayName, last.principalId);
        }

        return memberListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "member list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}

/**
 * Deactivation outranks a lockout: a revoked member who was also locked out is
 * revoked, and showing "Verrouillé" would suggest waiting fifteen minutes fixes
 * it. A lockout is read off `locked_until` rather than stored, so it lapses on
 * its own with nothing to sweep.
 */
function memberStatusOf(
  deactivatedAt: Date | null,
  lockedUntil: Date | null,
  now: number,
): MemberStatus {
  if (deactivatedAt !== null) return "DEACTIVATED";
  if (lockedUntil !== null && lockedUntil.getTime() > now) return "LOCKED";
  return "ACTIVE";
}
