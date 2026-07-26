import {
  assetLifecycleStatus,
  assetListResponse,
  listQuery,
} from "@routiq/contracts";
import { and, asc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { inWorkspace } from "../db/tenant.js";
import { assets, branches, categories } from "../db/schema.js";
import { registerCategoryReadRoutes } from "./categories.js";
import { registerDocumentReadRoutes } from "./documents.js";
import { registerReferenceReadRoutes } from "./reference.js";
import { afterTextKeyset, textKeysetCodec } from "./cursor.js";

// Read-side list conventions live in ADR-0003: Zod-validated filters, keyset
// pagination on a stable sort key, server-bounded limits.
const listQuerySchema = listQuery({
  // Repeated query params arrive as an array, a single one as a scalar; both
  // mean "one or more lifecycle statuses".
  status: z
    .union([assetLifecycleStatus, z.array(assetLifecycleStatus).min(1)])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    ),
  category: z.string().min(1).optional(),
  branchId: z.uuid().optional(),
  search: z.string().min(1).optional(),
});

/** `%` and `_` are ILIKE wildcards; a user typing them means the literal. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function registerAssetReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  // Piggybacked so reads/** wires itself without touching server.ts (backend-owned).
  // Backend: a reads/index.ts entry point would make this explicit.
  registerReferenceReadRoutes(app, db, requireAuth);
  registerCategoryReadRoutes(app, db, requireAuth);
  registerDocumentReadRoutes(app, db, requireAuth);

  app.get("/v1/assets", { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const auth = req.auth!;
      const parsedQuery = listQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
      }
      const { status, category, branchId, search, cursor, limit } =
        parsedQuery.data;

      const decodedCursor = cursor ? textKeysetCodec.decode(cursor) : undefined;
      if (cursor && !decodedCursor) {
        return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
      }

      const conditions: SQL[] = [eq(assets.workspaceId, auth.workspaceId)];

      // Branch scope comes from the session, never the client; a branchId
      // filter narrows inside it and can never widen it.
      if (auth.branchScope !== "ALL") {
        conditions.push(inArray(assets.branchId, auth.branchScope));
      }
      if (branchId) {
        conditions.push(eq(assets.branchId, branchId));
      }

      if (status) {
        conditions.push(inArray(assets.lifecycleStatus, status));
      }

      if (category) {
        conditions.push(eq(assets.assetClassCode, category));
      }

      // Operational identifiers plus the bilingual class labels the join
      // already carries. Branch code and name were searchable client-side and
      // are deliberately dropped here (ticket 13).
      if (search) {
        const pattern = likePattern(search);
        conditions.push(
          or(
            ilike(assets.assetCode, pattern),
            ilike(assets.registrationNumber, pattern),
            ilike(assets.manufacturer, pattern),
            ilike(assets.model, pattern),
            ilike(categories.labelFr, pattern),
            ilike(categories.labelEn, pattern),
          )!,
        );
      }

      if (decodedCursor) {
        conditions.push(afterTextKeyset(assets.assetCode, assets.id, decodedCursor));
      }

      const rows = await inWorkspace(db, auth.workspaceId, (tx) =>
        tx
          .select({
            id: assets.id,
            assetCode: assets.assetCode,
            registrationNumber: assets.registrationNumber,
            manufacturer: assets.manufacturer,
            model: assets.model,
            lifecycleStatus: assets.lifecycleStatus,
            rowVersion: assets.rowVersion,
            categoryCode: assets.assetClassCode,
            categoryLabelFr: categories.labelFr,
            categoryLabelEn: categories.labelEn,
            branchCode: branches.code,
            branchName: branches.name,
          })
          .from(assets)
          .innerJoin(
            branches,
            and(
              eq(branches.workspaceId, assets.workspaceId),
              eq(branches.id, assets.branchId),
            ),
          )
          .leftJoin(
            categories,
            and(
              eq(categories.workspaceId, assets.workspaceId),
              eq(categories.kind, "ASSET_CLASS"),
              eq(categories.code, assets.assetClassCode),
            ),
          )
          .where(and(...conditions))
          .orderBy(asc(assets.assetCode), asc(assets.id))
          // One extra row is the has-next probe, never returned.
          .limit(limit + 1),
      );

      const hasNextPage = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        id: row.id,
        assetCode: row.assetCode,
        registrationNumber: row.registrationNumber,
        manufacturer: row.manufacturer,
        model: row.model,
        lifecycleStatus: row.lifecycleStatus,
        rowVersion: row.rowVersion,
        category: {
          code: row.categoryCode,
          labelFr: row.categoryLabelFr ?? row.categoryCode,
          labelEn: row.categoryLabelEn ?? row.categoryCode,
        },
        branch: {
          code: row.branchCode,
          name: row.branchName,
        },
      }));

      let nextCursor: string | null = null;
      if (hasNextPage && items.length > 0) {
        const last = items[items.length - 1]!;
        nextCursor = textKeysetCodec.encode({ key: last.assetCode, id: last.id });
      }

      return assetListResponse.parse({ items, nextCursor });
    } catch (error) {
      req.log.error({ err: error }, "asset list read failed");
      return reply.status(500).send({ error: { code: "READ_FAILED" } });
    }
  });
}
