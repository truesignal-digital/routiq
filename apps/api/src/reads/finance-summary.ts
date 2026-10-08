import {
  financeSummaryQuery,
  financeSummaryResponse,
  ledgerEntryStatuses,
  type Role,
} from "@routiq/contracts";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { commands, financialEntries, postingPeriods, workspaces } from "../db/schema.js";
import { directionDecidesEntries, pendingApprovalConditions } from "./approvals-queue.js";
import { currentBusinessDate } from "./business-date.js";
import { defineRead, ENTRIES_GATE } from "./define-read.js";
import { entryEvidenceMissingSql } from "./entry-evidence.js";
import { monthBounds } from "./finance.js";
import { readableEntrySql } from "./money-scope.js";
import { serializeMinor } from "./serialize-minor.js";

/** approve-entry's `allowedRoles` (commands/entry-decisions.ts). */
const ENTRY_DECIDER_ROLES: readonly Role[] = ["DIRECTOR", "FINANCE"];

/**
 * `GET /v1/finance/summary`: the Money page's tiles and lead line (#314). Each
 * figure counts rows the entries list would show this caller, so a tile and the
 * list it filters cannot disagree.
 */
export function registerFinanceSummaryReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/finance/summary", ...ENTRIES_GATE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      const parsedQuery = financeSummaryQuery.safeParse(req.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
      }
      const { branchId } = parsedQuery.data;

      const result = await read(async (tx) => {
        const [workspace] = await tx
          .select({ currency: workspaces.defaultCurrency, timezone: workspaces.timezone })
          .from(workspaces)
          .where(eq(workspaces.id, auth.workspaceId));
        const currency = workspace?.currency ?? "XAF";
        const month = currentBusinessDate(
          new Date(),
          workspace?.timezone ?? "Africa/Douala",
        ).slice(0, 7);
        const { from, to } = monthBounds(month);

        const readable = [
          readableEntrySql(auth),
          ...(branchId === undefined ? [] : [eq(financialEntries.branchId, branchId)]),
        ];

        const latestPeriod = async (status: "OPEN" | "LOCKED") => {
          const [row] = await tx
            .select({ periodCode: postingPeriods.periodCode })
            .from(postingPeriods)
            .where(
              and(
                eq(postingPeriods.workspaceId, auth.workspaceId),
                eq(postingPeriods.status, status),
              ),
            )
            .orderBy(desc(postingPeriods.periodCode))
            .limit(1);
          return row?.periodCode ?? null;
        };

        // The entry's own signed amount: postings sum to it by invariant
        // (§3.4), and a reversal is a second, negative entry in the ledger set.
        const [totals] = await tx
          .select({
            outMinor: sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'EXPENSE' then ${financialEntries.amountMinor} else 0 end), 0)::text`,
            inMinor: sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'REVENUE' then ${financialEntries.amountMinor} else 0 end), 0)::text`,
          })
          .from(financialEntries)
          .where(
            and(
              ...readable,
              inArray(financialEntries.status, [...ledgerEntryStatuses]),
              eq(financialEntries.currency, currency),
              gte(financialEntries.economicDate, from),
              lt(financialEntries.economicDate, to),
            ),
          );

        const [missing] = await tx
          .select({
            count: sql<number>`count(*)::integer`,
            oldest: sql<string | null>`min(${financialEntries.economicDate})::text`,
          })
          .from(financialEntries)
          .where(and(...readable, entryEvidenceMissingSql()));

        let waiting: {
          count: number;
          amountMinor: bigint;
          oldestSubmittedAt: Date | null;
        } | null = null;
        if (ENTRY_DECIDER_ROLES.includes(auth.role)) {
          // The same queue `/v1/finance/approvals` lists, less what this caller
          // cannot decide: their own submissions (maker-checker) and entries
          // above their band (Direction decides).
          const pending = await tx
            .select({
              status: financialEntries.status,
              branchId: financialEntries.branchId,
              amountMinor: financialEntries.amountMinor,
              currency: financialEntries.currency,
              submittedAt: financialEntries.createdAt,
              submittedBy: commands.initiatedByPrincipalId,
            })
            .from(financialEntries)
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, financialEntries.workspaceId),
                eq(commands.id, financialEntries.createdByCommandId),
              ),
            )
            .where(and(...pendingApprovalConditions(auth, branchId)));
          const directionDecides = await directionDecidesEntries(tx, auth, pending);
          const decidable = pending.filter(
            (entry, index) =>
              entry.submittedBy !== auth.principalId && directionDecides[index] !== true,
          );
          waiting = { count: decidable.length, amountMinor: 0n, oldestSubmittedAt: null };
          for (const entry of decidable) {
            if (entry.currency === currency) {
              waiting.amountMinor += entry.amountMinor < 0n ? -entry.amountMinor : entry.amountMinor;
            }
            if (waiting.oldestSubmittedAt === null || entry.submittedAt < waiting.oldestSubmittedAt) {
              waiting.oldestSubmittedAt = entry.submittedAt;
            }
          }
        }

        return {
          currency,
          month,
          openPeriodCode: await latestPeriod("OPEN"),
          lastLockedPeriodCode: await latestPeriod("LOCKED"),
          outMinor: BigInt(totals?.outMinor ?? "0"),
          inMinor: BigInt(totals?.inMinor ?? "0"),
          missing: { count: missing?.count ?? 0, oldest: missing?.oldest ?? null },
          waiting,
        };
      });

      return financeSummaryResponse.parse({
        currency: result.currency,
        month: result.month,
        openPeriodCode: result.openPeriodCode,
        lastLockedPeriodCode: result.lastLockedPeriodCode,
        outMinor: serializeMinor(result.outMinor),
        inMinor: serializeMinor(result.inMinor),
        missingReceipt: {
          count: result.missing.count,
          oldestEconomicDate: result.missing.oldest,
        },
        waiting:
          result.waiting === null
            ? null
            : {
                count: result.waiting.count,
                amountMinor: serializeMinor(result.waiting.amountMinor),
                oldestSubmittedAt: result.waiting.oldestSubmittedAt?.toISOString() ?? null,
              },
      });
    },
  );
}
