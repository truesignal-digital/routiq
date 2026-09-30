import {
  branchListResponse,
  branchListSortFields,
  listQuery,
  type BranchListSortField,
  type ListSort,
} from "@routiq/contracts";
import { and, eq, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { branches } from "../db/schema.js";
import {
  afterKeyset,
  bindText,
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  type KeysetColumn,
} from "./cursor.js";
import { ADMIN_ONLY, defineRead } from "./define-read.js";

const listQuerySchema = listQuery({}, { sortFields: branchListSortFields });

const defaultBranchSort: ListSort<BranchListSortField> = {
  field: "code",
  direction: "asc",
};

const branchSortColumns: Record<BranchListSortField, KeysetColumn> = {
  code: { column: branches.code, bind: bindText },
};

/**
 * The branch administration list. Two things separate it from every other list
 * read: it shows inactive branches (reactivating one is why the screen exists,
 * and a deactivated branch hidden from the list could never come back), and it
 * ignores the caller's branch scope.
 *
 * Ignoring scope is deliberate and matches the commands behind the screen, which
 * declare `branchAuthorization: { kind: "workspace" }` — administering the set of
 * branches is a workspace-level act, not an act within one. ADMIN-only, so no
 * narrower role can read past its own scope this way.
 */
export function registerBranchReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/branches", module: "CORE", roles: ADMIN_ONLY, branchScope: "workspace" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = listQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { cursor, limit } = parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultBranchSort;
        const sortColumn = branchSortColumns[sort.field];

        const decodedCursor = cursor ? decodeKeysetCursor(cursor, sort) : undefined;
        if (cursor && !decodedCursor) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }

        const conditions: SQL[] = [eq(branches.workspaceId, auth.workspaceId)];
        if (decodedCursor) {
          conditions.push(
            afterKeyset(sortColumn, sort.direction, branches.id, decodedCursor),
          );
        }

        const rows = await read((tx) =>
          tx
            .select({
              id: branches.id,
              code: branches.code,
              name: branches.name,
              timezone: branches.timezone,
              active: branches.active,
              rowVersion: branches.rowVersion,
            })
            .from(branches)
            .where(and(...conditions))
            .orderBy(...keysetOrderBy(sortColumn, sort.direction, branches.id))
            // One extra row is the has-next probe, never returned.
            .limit(limit + 1),
        );

        const hasNextPage = rows.length > limit;
        const items = rows.slice(0, limit);

        let nextCursor: string | null = null;
        if (hasNextPage && items.length > 0) {
          const last = items[items.length - 1]!;
          nextCursor = encodeKeysetCursor(sort, last.code, last.id);
        }

        return branchListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "branch list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
