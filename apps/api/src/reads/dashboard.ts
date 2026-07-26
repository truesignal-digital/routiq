import type { AssetLifecycleStatus } from "@routiq/contracts";
import { dashboardResponse } from "@routiq/contracts";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext } from "../auth/types.js";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import {
  assets,
  financialEntries,
  financialPostings,
  postingPeriods,
  workspaces,
} from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { pendingApprovalConditions } from "./approvals-queue.js";
import { serializeMinor } from "./serialize-minor.js";

/**
 * Statuses whose postings are part of the ledger. A REVERSED entry keeps its
 * original postings; the reversal is a second POSTED entry carrying the negated
 * lines, so the pair nets to zero only when both are summed (§3.4). Counting
 * POSTED alone would leave the negated half behind and report a false loss.
 */
const LEDGER_ENTRY_STATUSES = ["POSTED", "REVERSED"] as const;

/** Zero-filled so every lifecycle status is reported, including the empty ones. */
function zeroedStatusCounts(): Record<AssetLifecycleStatus, number> {
  return {
    REGISTERED: 0,
    IN_SERVICE: 0,
    UNDER_MAINTENANCE: 0,
    SOLD: 0,
    RETIRED: 0,
    WRITTEN_OFF: 0,
  };
}

/** Branch scope comes from the session, never the query string (ADR-0003). */
function branchScoped(auth: AuthContext, branchIdColumn: AnyPgColumn): SQL[] {
  return auth.branchScope === "ALL"
    ? []
    : [inArray(branchIdColumn, auth.branchScope)];
}

export function registerDashboardReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  app.get(
    "/v1/dashboard",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const assetRows = await tx
            .select({
              lifecycleStatus: assets.lifecycleStatus,
              count: sql<number>`count(*)::integer`,
            })
            .from(assets)
            .where(
              and(
                eq(assets.workspaceId, auth.workspaceId),
                ...branchScoped(auth, assets.branchId),
              ),
            )
            .groupBy(assets.lifecycleStatus);

          const [approvalsCount] = await tx
            .select({ count: sql<number>`count(*)::integer` })
            .from(financialEntries)
            .where(and(...pendingApprovalConditions(auth)));

          // Latest open period is "current": periods are auto-created per
          // economic month, and an older one may still be open behind it.
          const [openPeriod] = await tx
            .select({
              id: postingPeriods.id,
              periodCode: postingPeriods.periodCode,
            })
            .from(postingPeriods)
            .where(
              and(
                eq(postingPeriods.workspaceId, auth.workspaceId),
                eq(postingPeriods.status, "OPEN"),
              ),
            )
            .orderBy(desc(postingPeriods.periodCode))
            .limit(1);

          if (!openPeriod) {
            return { assetRows, approvalsCount, openPeriod: null };
          }

          const [workspace] = await tx
            .select({ defaultCurrency: workspaces.defaultCurrency })
            .from(workspaces)
            .where(eq(workspaces.id, auth.workspaceId));
          const currency = workspace?.defaultCurrency ?? "XAF";

          // Sum the postings, not the entry amounts: postings are the canonical
          // signed lines, and summing them can't double-count a multi-line
          // entry. Restricted to one currency so the total is never a mix.
          const [totals] = await tx
            .select({
              expenseMinor: sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'EXPENSE' then ${financialPostings.amountMinor} else 0 end), 0)::text`,
              revenueMinor: sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'REVENUE' then ${financialPostings.amountMinor} else 0 end), 0)::text`,
            })
            .from(financialPostings)
            .innerJoin(
              financialEntries,
              and(
                eq(financialEntries.workspaceId, financialPostings.workspaceId),
                eq(financialEntries.id, financialPostings.financialEntryId),
              ),
            )
            .where(
              and(
                eq(financialPostings.workspaceId, auth.workspaceId),
                eq(financialEntries.postingPeriodId, openPeriod.id),
                inArray(financialEntries.status, [...LEDGER_ENTRY_STATUSES]),
                eq(financialEntries.currency, currency),
                ...branchScoped(auth, financialEntries.branchId),
              ),
            );

          return {
            assetRows,
            approvalsCount,
            openPeriod: {
              periodCode: openPeriod.periodCode,
              currency,
              expenseMinor: totals?.expenseMinor ?? "0",
              revenueMinor: totals?.revenueMinor ?? "0",
            },
          };
        });

        const byStatus = zeroedStatusCounts();
        let total = 0;
        for (const row of result.assetRows) {
          byStatus[row.lifecycleStatus] = row.count;
          total += row.count;
        }

        return dashboardResponse.parse({
          assets: { total, byStatus },
          openPeriod:
            result.openPeriod === null
              ? null
              : {
                  periodCode: result.openPeriod.periodCode,
                  postedExpenseMinor: serializeMinor(
                    BigInt(result.openPeriod.expenseMinor),
                  ),
                  postedRevenueMinor: serializeMinor(
                    BigInt(result.openPeriod.revenueMinor),
                  ),
                  currency: result.openPeriod.currency,
                },
          pendingApprovals: { count: result.approvalsCount?.count ?? 0 },
        });
      } catch (error) {
        req.log.error({ err: error }, "dashboard read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
