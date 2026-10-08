import { custodianCandidatesResponse } from "@routiq/contracts";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import { custodianIneligibility } from "../commands/custodian-eligibility.js";
import type { Db } from "../db/client.js";
import { memberships, principals } from "../db/schema.js";
import { requireScopedAsset } from "./asset-scope.js";
import { invalidRequest, sendReadFailure } from "./read-gate.js";
import { defineRead } from "./define-read.js";

/** The roles `assign-asset` lets change a custodian without an approval step. */
const CUSTODY_ROLES = ["DIRECTOR", "ADMIN"] as const;

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
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/assets/:assetId/custodian-candidates", module: "ASSETS", roles: CUSTODY_ROLES, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const params = z.object({ assetId: z.uuid() }).safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { assetId } = params.data;

        const items = await read(async (tx) => {
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
