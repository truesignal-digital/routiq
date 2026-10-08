import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { categories } from "../db/schema.js";
import { ANY_ROLE, defineRead } from "./define-read.js";

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
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/categories", module: "CORE", roles: ANY_ROLE, branchScope: "workspace" },
    async ({ req, reply, auth, read }) => {
      try {
        const kind = (req.query as Record<string, unknown>)["kind"];
        if (!isCategoryKind(kind)) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const rows = await read((tx) =>
          tx
            .select({
              code: categories.code,
              labelFr: categories.labelFr,
              labelEn: categories.labelEn,
              // Meaningful on ISSUE_TYPE only (pre-checks the reporter's
              // safety-critical box); false on every other kind.
              defaultSafetyCritical: categories.defaultSafetyCritical,
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
