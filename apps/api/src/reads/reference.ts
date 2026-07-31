import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { inWorkspace } from "../db/tenant.js";
import { branches, categories } from "../db/schema.js";

/** Reference data the register form needs: asset classes + visible branches. */
export function registerReferenceReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  app.get(
    "/v1/reference/asset-registration",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;

        const { assetClasses, visibleBranches } = await inWorkspace(
          db,
          auth.workspaceId,
          async (tx) => ({
            assetClasses: await tx
              .select({
                code: categories.code,
                labelFr: categories.labelFr,
                labelEn: categories.labelEn,
              })
              .from(categories)
              .where(
                and(
                  eq(categories.workspaceId, auth.workspaceId),
                  eq(categories.kind, "ASSET_CLASS"),
                  eq(categories.active, true),
                ),
              )
              .orderBy(asc(categories.code)),
            visibleBranches: await tx
              .select({ id: branches.id, code: branches.code, name: branches.name })
              .from(branches)
              .where(
                and(
                  eq(branches.workspaceId, auth.workspaceId),
                  eq(branches.active, true),
                ),
              )
              .orderBy(asc(branches.code)),
          }),
        );

        const scoped =
          auth.branchScope === "ALL"
            ? visibleBranches
            : visibleBranches.filter((b) => auth.branchScope.includes(b.id));

        // The id travels too: list reads filter on `branchId`, so a branch
        // picker built from this would otherwise have nothing to send.
        return { assetClasses, branches: scoped };
      } catch (error) {
        req.log.error({ err: error }, "asset registration reference read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
