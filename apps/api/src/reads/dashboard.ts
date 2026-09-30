import type { AssetLifecycleStatus } from "@routiq/contracts";
import {
  FINANCE_READER_ROLES,
  dashboardQuery,
  dashboardResponse,
  ledgerEntryStatuses,
  type Role,
} from "@routiq/contracts";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import type { AuthContext } from "../auth/types.js";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { isModuleEnabled } from "../modules/registry.js";
import { ANY_ROLE, defineRead } from "./define-read.js";
import {
  assets,
  financialEntries,
  financialPostings,
  postingPeriods,
  workspaces,
} from "../db/schema.js";
import {
  countPendingOutsideBranch,
  pendingApprovalConditions,
} from "./approvals-queue.js";
import { currentBusinessDate, dayWindow } from "./business-date.js";
import { serializeMinor } from "./serialize-minor.js";

/**
 * Statuses whose postings are part of the ledger. A REVERSED entry keeps its
 * original postings; the reversal is a second POSTED entry carrying the negated
 * lines, so the pair nets to zero only when both are summed (§3.4). Counting
 * POSTED alone would leave the negated half behind and report a false loss.
 */
export const LEDGER_ENTRY_STATUSES = ledgerEntryStatuses;

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

/**
 * Branch scope comes from the session, never the query string (ADR-0003). The
 * optional `branchId` is applied on top of that scope, never instead of it, so
 * asking for a branch outside the caller's scope narrows to nothing rather than
 * widening to it.
 */
function branchScoped(
  auth: AuthContext,
  branchIdColumn: AnyPgColumn,
  branchId?: string,
): SQL[] {
  const conditions: SQL[] =
    auth.branchScope === "ALL" ? [] : [inArray(branchIdColumn, auth.branchScope)];
  if (branchId !== undefined) conditions.push(eq(branchIdColumn, branchId));
  return conditions;
}

export function registerDashboardReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/dashboard", module: "CORE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = dashboardQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { days, branchId } = parsedQuery.data;

        const result = await read(async (tx) => {
          const assetRows = await tx
            .select({
              lifecycleStatus: assets.lifecycleStatus,
              count: sql<number>`count(*)::integer`,
            })
            .from(assets)
            .where(
              and(
                eq(assets.workspaceId, auth.workspaceId),
                ...branchScoped(auth, assets.branchId, branchId),
              ),
            )
            .groupBy(assets.lifecycleStatus);

          // The home screen is for every role, its finance figures are not
          // (#59): a caller who may not read finance gets no finance numbers,
          // not zeros, so nothing on the card can claim a balance.
          const financeVisible =
            (FINANCE_READER_ROLES as readonly Role[]).includes(auth.role) &&
            (await isModuleEnabled(tx, auth.workspaceId, "FINANCE"));
          if (!financeVisible) return { assetRows, finance: null };

          const [approvalsCount] = await tx
            .select({ count: sql<number>`count(*)::integer` })
            .from(financialEntries)
            .where(and(...pendingApprovalConditions(auth, branchId)));

          // The same overflow the approvals queue reports, from the same
          // helper: the card and the queue cannot disagree about the work the
          // branch narrowing leaves off screen.
          const approvalsOutsideBranch = await countPendingOutsideBranch(
            tx,
            auth,
            branchId,
          );

          const [workspace] = await tx
            .select({
              defaultCurrency: workspaces.defaultCurrency,
              timezone: workspaces.timezone,
            })
            .from(workspaces)
            .where(eq(workspaces.id, auth.workspaceId));
          const currency = workspace?.defaultCurrency ?? "XAF";

          const windowEnd = currentBusinessDate(
            new Date(),
            workspace?.timezone ?? "Africa/Douala",
          );
          const windowDates = dayWindow(windowEnd, days);
          const windowStart = windowDates[0]!;

          // Bucketed on economic_date, which is already a date column — no
          // date_trunc, so a day is exactly a day with no timestamp rounding.
          // Same predicates as the period totals: signed postings, POSTED plus
          // REVERSED so a reversal nets its own economic day back to zero.
          const seriesRows = await tx
            .select({
              date: financialEntries.economicDate,
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
                inArray(financialEntries.status, [...LEDGER_ENTRY_STATUSES]),
                eq(financialEntries.currency, currency),
                gte(financialEntries.economicDate, windowStart),
                lte(financialEntries.economicDate, windowEnd),
                ...branchScoped(auth, financialEntries.branchId, branchId),
              ),
            )
            .groupBy(financialEntries.economicDate);

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
            return {
              assetRows,
              finance: {
                approvalsCount,
                approvalsOutsideBranch,
                openPeriod: null,
                window: windowDates,
                seriesRows,
              },
            };
          }

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
                ...branchScoped(auth, financialEntries.branchId, branchId),
              ),
            );

          return {
            assetRows,
            finance: {
              approvalsCount,
              approvalsOutsideBranch,
              openPeriod: {
                periodCode: openPeriod.periodCode,
                currency,
                expenseMinor: totals?.expenseMinor ?? "0",
                revenueMinor: totals?.revenueMinor ?? "0",
              },
              window: windowDates,
              seriesRows,
            },
          };
        });

        const byStatus = zeroedStatusCounts();
        let total = 0;
        for (const row of result.assetRows) {
          byStatus[row.lifecycleStatus] = row.count;
          total += row.count;
        }

        // Zero-fill here rather than in the chart: a day the client never
        // received is indistinguishable from a day it failed to draw, and an
        // area chart bridges the gap silently.
        const { finance } = result;
        const postedByDay = new Map(
          (finance?.seriesRows ?? []).map((row) => [row.date, row]),
        );
        const series =
          finance === null
            ? null
            : finance.window.map((date) => {
                const posted = postedByDay.get(date);
                return {
                  date,
                  expenseMinor: serializeMinor(BigInt(posted?.expenseMinor ?? "0")),
                  revenueMinor: serializeMinor(BigInt(posted?.revenueMinor ?? "0")),
                };
              });

        return dashboardResponse.parse({
          assets: { total, byStatus },
          openPeriod:
            finance === null || finance.openPeriod === null
              ? null
              : {
                  periodCode: finance.openPeriod.periodCode,
                  postedExpenseMinor: serializeMinor(
                    BigInt(finance.openPeriod.expenseMinor),
                  ),
                  postedRevenueMinor: serializeMinor(
                    BigInt(finance.openPeriod.revenueMinor),
                  ),
                  currency: finance.openPeriod.currency,
                },
          pendingApprovals:
            finance === null
              ? null
              : {
                  count: finance.approvalsCount?.count ?? 0,
                  outsideBranchCount: finance.approvalsOutsideBranch,
                },
          series,
        });
      } catch (error) {
        req.log.error({ err: error }, "dashboard read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
