import {
  assetDetail,
  assetLifecycleStatus,
  assetListResponse,
  listQuery,
} from "@routiq/contracts";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { inWorkspace } from "../db/tenant.js";
import {
  activities,
  activityAssetSegments,
  assets,
  branches,
  categories,
  financialEntries,
  financialPostings,
  workspaces,
} from "../db/schema.js";
import { registerCategoryReadRoutes } from "./categories.js";
import { LEDGER_ENTRY_STATUSES } from "./dashboard.js";
import { registerDocumentReadRoutes } from "./documents.js";
import { registerReferenceReadRoutes } from "./reference.js";
import { afterTextKeyset, textKeysetCodec } from "./cursor.js";
import { serializeMinor } from "./serialize-minor.js";

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

/** The asset page shows a recent slice, not a history; /v1/activities?assetId= pages the rest. */
const RECENT_ACTIVITY_LIMIT = 10;

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

  app.get(
    "/v1/assets/:assetId",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedParams = z
          .object({ assetId: z.uuid() })
          .safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { assetId } = parsedParams.data;

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const headerConditions: SQL[] = [
            eq(assets.workspaceId, auth.workspaceId),
            eq(assets.id, assetId),
          ];
          if (auth.branchScope !== "ALL") {
            headerConditions.push(inArray(assets.branchId, auth.branchScope));
          }

          const [header] = await tx
            .select({
              id: assets.id,
              assetCode: assets.assetCode,
              registrationNumber: assets.registrationNumber,
              manufacturer: assets.manufacturer,
              model: assets.model,
              modelYear: assets.modelYear,
              chassisNumber: assets.chassisNumber,
              lifecycleStatus: assets.lifecycleStatus,
              rowVersion: assets.rowVersion,
              assetClassCode: assets.assetClassCode,
              categoryLabelFr: categories.labelFr,
              categoryLabelEn: categories.labelEn,
              templateCode: assets.templateCode,
              templateVersion: assets.templateVersion,
              acquisitionDate: assets.acquisitionDate,
              acquisitionAmountMinor: assets.acquisitionAmountMinor,
              currency: assets.currency,
              commissionedAt: assets.commissionedAt,
              customValues: assets.customValues,
              branchId: assets.branchId,
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
            .where(and(...headerConditions))
            .limit(1);

          // Out of the caller's workspace or branch scope is the same answer as
          // "no such asset" — a 403 would confirm the row exists elsewhere.
          if (!header) return undefined;

          const [workspace] = await tx
            .select({ defaultCurrency: workspaces.defaultCurrency })
            .from(workspaces)
            .where(eq(workspaces.id, auth.workspaceId));
          const currency = workspace?.defaultCurrency ?? "XAF";

          // Same predicates as the dashboard totals: signed postings, POSTED
          // plus REVERSED so a reversed entry and its negated mirror cancel,
          // one currency so the total is never a mix. Branch scope applies to
          // the entries too — a scoped reader never sees another branch's money.
          const financeConditions: SQL[] = [
            eq(financialPostings.workspaceId, auth.workspaceId),
            eq(financialPostings.assetId, assetId),
            inArray(financialEntries.status, [...LEDGER_ENTRY_STATUSES]),
            eq(financialEntries.currency, currency),
          ];
          if (auth.branchScope !== "ALL") {
            financeConditions.push(
              inArray(financialEntries.branchId, auth.branchScope),
            );
          }

          const revenueSum = sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'REVENUE' then ${financialPostings.amountMinor} else 0 end), 0)::text`;
          const expenseSum = sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'EXPENSE' then ${financialPostings.amountMinor} else 0 end), 0)::text`;

          // Postings own the asset link, so the join starts there; the entry
          // supplies direction, status and currency.
          const [totals] = await tx
            .select({ revenueMinor: revenueSum, expenseMinor: expenseSum })
            .from(financialPostings)
            .innerJoin(
              financialEntries,
              and(
                eq(financialEntries.workspaceId, financialPostings.workspaceId),
                eq(financialEntries.id, financialPostings.financialEntryId),
              ),
            )
            .where(and(...financeConditions));

          const categoryTotal = sql<string>`sum(${financialPostings.amountMinor})::text`;
          const categoryRows = await tx
            .select({
              code: categories.code,
              labelFr: categories.labelFr,
              labelEn: categories.labelEn,
              totalMinor: categoryTotal,
            })
            .from(financialPostings)
            .innerJoin(
              financialEntries,
              and(
                eq(financialEntries.workspaceId, financialPostings.workspaceId),
                eq(financialEntries.id, financialPostings.financialEntryId),
              ),
            )
            .innerJoin(
              categories,
              and(
                eq(categories.workspaceId, financialPostings.workspaceId),
                eq(categories.id, financialPostings.categoryId),
              ),
            )
            .where(
              and(
                ...financeConditions,
                eq(financialEntries.direction, "EXPENSE"),
              ),
            )
            .groupBy(categories.code, categories.labelFr, categories.labelEn)
            // A category whose charges were all reversed nets to zero; listing
            // it would read as a cost that is no longer in the books.
            .having(sql`sum(${financialPostings.amountMinor}) <> 0`)
            .orderBy(desc(sql`sum(${financialPostings.amountMinor})`));

          const activityConditions: SQL[] = [
            eq(activities.workspaceId, auth.workspaceId),
            // An asset can hold several segments on one activity (substitution,
            // trailer swap); EXISTS keeps the activity a single row.
            exists(
              tx
                .select({ one: sql`1` })
                .from(activityAssetSegments)
                .where(
                  and(
                    eq(
                      activityAssetSegments.workspaceId,
                      activities.workspaceId,
                    ),
                    eq(activityAssetSegments.activityId, activities.id),
                    eq(activityAssetSegments.assetId, assetId),
                  ),
                ),
            ),
          ];
          if (auth.branchScope !== "ALL") {
            activityConditions.push(
              inArray(activities.branchId, auth.branchScope),
            );
          }

          const activityRows = await tx
            .select({
              id: activities.id,
              activityNumber: activities.activityNumber,
              activityTypeCode: categories.code,
              activityTypeLabelFr: categories.labelFr,
              activityTypeLabelEn: categories.labelEn,
              status: activities.status,
              completeness: activities.completeness,
              customerName: activities.customerName,
              startedAt: activities.startedAt,
              endedAt: activities.endedAt,
            })
            .from(activities)
            .innerJoin(
              categories,
              and(
                eq(categories.workspaceId, activities.workspaceId),
                eq(categories.id, activities.activityTypeId),
                eq(categories.kind, "ACTIVITY_TYPE"),
              ),
            )
            .where(and(...activityConditions))
            .orderBy(desc(activities.startedAt), desc(activities.id))
            .limit(RECENT_ACTIVITY_LIMIT);

          return { header, currency, totals, categoryRows, activityRows };
        });

        if (!result) {
          return reply
            .status(404)
            .send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }

        const { header, currency, totals, categoryRows, activityRows } = result;
        const revenueMinor = BigInt(totals?.revenueMinor ?? "0");
        const expenseMinor = BigInt(totals?.expenseMinor ?? "0");

        return assetDetail.parse({
          id: header.id,
          assetCode: header.assetCode,
          registrationNumber: header.registrationNumber,
          manufacturer: header.manufacturer,
          model: header.model,
          modelYear: header.modelYear,
          chassisNumber: header.chassisNumber,
          lifecycleStatus: header.lifecycleStatus,
          rowVersion: header.rowVersion,
          assetClassCode: header.assetClassCode,
          category: {
            code: header.assetClassCode,
            labelFr: header.categoryLabelFr ?? header.assetClassCode,
            labelEn: header.categoryLabelEn ?? header.assetClassCode,
          },
          templateCode: header.templateCode,
          templateVersion: header.templateVersion,
          acquisitionDate: header.acquisitionDate,
          acquisitionAmountMinor:
            header.acquisitionAmountMinor === null
              ? null
              : serializeMinor(header.acquisitionAmountMinor),
          currency: header.currency,
          commissionedAt: header.commissionedAt?.toISOString() ?? null,
          customValues: header.customValues,
          branchId: header.branchId,
          branch: { code: header.branchCode, name: header.branchName },
          finance: {
            currency,
            revenueMinor: serializeMinor(revenueMinor),
            expenseMinor: serializeMinor(expenseMinor),
            netMinor: serializeMinor(revenueMinor - expenseMinor),
            expenseByCategory: categoryRows.map((row) => ({
              code: row.code,
              labelFr: row.labelFr,
              labelEn: row.labelEn,
              totalMinor: serializeMinor(BigInt(row.totalMinor)),
            })),
          },
          recentActivities: activityRows.map((row) => ({
            id: row.id,
            activityNumber: row.activityNumber,
            activityType: {
              code: row.activityTypeCode,
              labelFr: row.activityTypeLabelFr,
              labelEn: row.activityTypeLabelEn,
            },
            status: row.status,
            completeness: row.completeness,
            customerName: row.customerName,
            startedAt: row.startedAt?.toISOString() ?? null,
            endedAt: row.endedAt?.toISOString() ?? null,
          })),
        });
      } catch (error) {
        req.log.error({ err: error }, "asset detail read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
