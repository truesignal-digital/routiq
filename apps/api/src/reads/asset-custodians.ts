import { custodianCandidatesResponse } from "@routiq/contracts";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import { custodianIneligibility } from "../commands/custodian-eligibility.js";
import type { Db } from "../db/client.js";
import { memberships, principals } from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { requireScopedAsset } from "./asset-scope.js";
import { invalidRequest, passReadGate, sendReadFailure } from "./read-gate.js";

/** The roles `assign-asset` lets change a custodian without an approval step. */
const CUSTODY_ROLES = ["ADMIN", "OPS_MANAGER"] as const;

export function registerAssetCustodianReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * The members the vehicle may be handed to. `/v1/members` is ADMIN-only, and
   * an operations manager changing a custodian needs this narrower list: names
   * and roles of the members `assign-asset` would accept, nothing more.
   */
  app.get(
    "/v1/assets/:assetId/custodian-candidates",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const params = z.object({ assetId: z.uuid() }).safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { assetId } = params.data;

        const items = await inWorkspace(db, auth.workspaceId, async (tx) => {
          await passReadGate(tx, auth, { module: "ASSETS", roles: CUSTODY_ROLES });
          const asset = await requireScopedAsset(tx, auth, assetId);

          const rows = await tx
            .select({
              membershipId: memberships.id,
              displayName: principals.displayName,
              role: memberships.role,
              deactivatedAt: memberships.deactivatedAt,
              allBranches: memberships.allBranches,
              branchIds: memberships.branchIds,
            })
            .from(memberships)
            .innerJoin(principals, eq(principals.id, memberships.principalId))
            .where(
              and(
                eq(memberships.workspaceId, auth.workspaceId),
                isNull(memberships.deactivatedAt),
              ),
            )
            .orderBy(asc(principals.displayName), asc(memberships.id));

          return rows
            .filter((row) => custodianIneligibility(row, asset.branchId) === undefined)
            .map(({ membershipId, displayName, role }) => ({ membershipId, displayName, role }));
        });

        return custodianCandidatesResponse.parse({ items });
      } catch (error) {
        return sendReadFailure(req, reply, error, "custodian candidates");
      }
    },
  );
}
