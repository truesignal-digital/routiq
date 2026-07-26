import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { inWorkspace } from "../db/tenant.js";
import { categories } from "../db/schema.js";

const CATEGORY_KINDS = [
  "ASSET_CLASS",
  "ACTIVITY_TYPE",
  "REVENUE_CATEGORY",
  "EXPENSE_CATEGORY",
  "DOCUMENT_TYPE",
  "ISSUE_TYPE",
] as const;

type CategoryKind = (typeof CATEGORY_KINDS)[number];

function isCategoryKind(value: unknown): value is CategoryKind {
  return (CATEGORY_KINDS as readonly unknown[]).includes(value);
}

export function registerCategoryReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  app.get(
    "/v1/categories",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const kind = (req.query as Record<string, unknown>)["kind"];
        if (!isCategoryKind(kind)) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const rows = await inWorkspace(db, auth.workspaceId, (tx) =>
          tx
            .select({
              code: categories.code,
              labelFr: categories.labelFr,
              labelEn: categories.labelEn,
            })
            .from(categories)
            .where(
              and(
                eq(categories.workspaceId, auth.workspaceId),
                eq(categories.kind, kind as CategoryKind),
                eq(categories.active, true),
              ),
            )
            .orderBy(asc(categories.code)),
        );
        return { kind, categories: rows };
      } catch (error) {
        req.log.error({ err: error }, "categories read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
