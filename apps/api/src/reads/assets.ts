import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { assets, branches, categories } from "../db/schema.js";

export function registerAssetReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  app.get("/v1/assets", { preHandler: requireAuth }, async (req) => {
    const auth = req.auth!;
    const branchFilter =
      auth.branchScope === "ALL"
        ? eq(assets.workspaceId, auth.workspaceId)
        : and(
            eq(assets.workspaceId, auth.workspaceId),
            inArray(assets.branchId, auth.branchScope),
          );

    const rows = await db
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
      .where(branchFilter)
      .orderBy(asc(assets.assetCode));

    return {
      workspaceId: auth.workspaceId,
      assets: rows.map((row) => ({
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
      })),
    };
  });
}
