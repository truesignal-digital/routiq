import {
  assetFinanceQuery,
  assetFinanceResponse,
  PROFITABILITY_LAYERS,
} from "@routiq/contracts";
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import { currentPeriodCode } from "../commands/periods.js";
import type { Db } from "../db/client.js";
import {
  categories,
  financialEntries,
  financialPostings,
  postingPeriods,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { requireScopedAsset } from "./asset-scope.js";
import { LEDGER_ENTRY_STATUSES } from "./dashboard.js";
import { entryEvidenceMissingSql } from "./entry-evidence.js";
import { monthBounds } from "./finance.js";
import { invalidRequest, sendReadFailure } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";
import { defineRead, LEDGER_GATE } from "./define-read.js";

const SERIES_MONTHS = 6;

/** `YYYY-MM` shifted by whole months — string arithmetic, no timezone involved. */
export function shiftMonth(periodCode: string, delta: number): string {
  const [year, month] = periodCode.split("-").map(Number) as [number, number];
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const minor = (value: string | null | undefined): number => serializeMinor(BigInt(value ?? "0"));

/**
 * This vehicle's lines, in the workspace currency, of entries the caller may
 * read. Branch scope is the ENTRY's branch: a Yaoundé entry with a line on a
 * Douala truck stays a Yaoundé record, whatever the truck is.
 */
function vehicleLines(auth: AuthContext, assetId: string, currency: string): SQL[] {
  const conditions: SQL[] = [
    eq(financialPostings.workspaceId, auth.workspaceId),
    eq(financialPostings.assetId, assetId),
    eq(financialEntries.currency, currency),
  ];
  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(financialEntries.branchId, auth.branchScope));
  }
  return conditions;
}

const entryJoin = and(
  eq(financialEntries.workspaceId, financialPostings.workspaceId),
  eq(financialEntries.id, financialPostings.financialEntryId),
);

// The ENTRY's period, not the posting's copy — what the dashboard reads.
const periodJoin = and(
  eq(postingPeriods.workspaceId, financialEntries.workspaceId),
  eq(postingPeriods.id, financialEntries.postingPeriodId),
);

const expenseSum = sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'EXPENSE' then ${financialPostings.amountMinor} else 0 end), 0)::text`;
const revenueSum = sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'REVENUE' then ${financialPostings.amountMinor} else 0 end), 0)::text`;
const entryCount = sql<number>`count(distinct ${financialEntries.id})::int`;

async function loadFinance(
  tx: TenantTx,
  auth: AuthContext,
  assetId: string,
  requestedPeriod: string | undefined,
) {
  const [workspace] = await tx
    .select({ currency: workspaces.defaultCurrency, timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.id, auth.workspaceId));
  const currency = workspace?.currency ?? "XAF";
  const periodCode = requestedPeriod ?? currentPeriodCode(new Date(), workspace?.timezone ?? "Africa/Douala");

  const [period] = await tx
    .select({ status: postingPeriods.status })
    .from(postingPeriods)
    .where(and(eq(postingPeriods.workspaceId, auth.workspaceId), eq(postingPeriods.periodCode, periodCode)))
    .limit(1);

  const lines = vehicleLines(auth, assetId, currency);
  const postedSet = [
    ...lines,
    inArray(financialEntries.status, [...LEDGER_ENTRY_STATUSES]),
    eq(postingPeriods.periodCode, periodCode),
  ];
  const { from, to } = monthBounds(periodCode);
  const economicMonth = [
    gte(financialPostings.economicDate, from),
    lt(financialPostings.economicDate, to),
    eq(financialEntries.direction, "EXPENSE"),
  ];
  const pendingSet = [...lines, ...economicMonth, eq(financialEntries.status, "SUBMITTED")];
  const rejectedSet = [...lines, ...economicMonth, eq(financialEntries.status, "REJECTED")];

  const [posted] = await tx
    .select({ expenseMinor: expenseSum, revenueMinor: revenueSum, entryCount })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .innerJoin(postingPeriods, periodJoin)
    .where(and(...postedSet));

  const [pending] = await tx
    .select({ expenseMinor: expenseSum, entryCount })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .where(and(...pendingSet));

  const [rejected] = await tx
    .select({ entryCount })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .where(and(...rejectedSet));

  const [postedMissing] = await tx
    .select({ entryCount })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .innerJoin(postingPeriods, periodJoin)
    .where(and(...postedSet, entryEvidenceMissingSql()));

  const [pendingMissing] = await tx
    .select({ entryCount })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .where(and(...pendingSet, entryEvidenceMissingSql()));

  const categoryTotal = sql<string>`sum(${financialPostings.amountMinor})`;
  const byCategory = await tx
    .select({
      code: categories.code,
      labelFr: categories.labelFr,
      labelEn: categories.labelEn,
      layer: categories.profitabilityLayer,
      expenseMinor: sql<string>`${categoryTotal}::text`,
    })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .innerJoin(postingPeriods, periodJoin)
    .innerJoin(
      categories,
      and(eq(categories.workspaceId, financialPostings.workspaceId), eq(categories.id, financialPostings.categoryId)),
    )
    .where(and(...postedSet, eq(financialEntries.direction, "EXPENSE")))
    .groupBy(categories.code, categories.labelFr, categories.labelEn, categories.profitabilityLayer)
    // A category whose charges were all reversed nets to zero; listing it would
    // read as a cost still in the books.
    .having(sql`${categoryTotal} <> 0`)
    .orderBy(desc(categoryTotal), categories.code);

  const seriesCodes = Array.from({ length: SERIES_MONTHS }, (_, i) =>
    shiftMonth(periodCode, i - SERIES_MONTHS + 1),
  );
  const seriesRows = await tx
    .select({ periodCode: postingPeriods.periodCode, expenseMinor: expenseSum, revenueMinor: revenueSum })
    .from(financialPostings)
    .innerJoin(financialEntries, entryJoin)
    .innerJoin(postingPeriods, periodJoin)
    .where(
      and(
        ...lines,
        inArray(financialEntries.status, [...LEDGER_ENTRY_STATUSES]),
        inArray(postingPeriods.periodCode, seriesCodes),
      ),
    )
    .groupBy(postingPeriods.periodCode);
  const seriesByCode = new Map(seriesRows.map((row) => [row.periodCode, row]));

  return {
    assetId,
    currency,
    periodCode,
    periodStatus: period?.status ?? "NOT_STARTED",
    layers: [...PROFITABILITY_LAYERS],
    posted: {
      basis: "POSTING_PERIOD",
      expenseMinor: minor(posted?.expenseMinor),
      revenueMinor: minor(posted?.revenueMinor),
      entryCount: posted?.entryCount ?? 0,
    },
    pending: {
      basis: "ECONOMIC_MONTH",
      expenseMinor: minor(pending?.expenseMinor),
      entryCount: pending?.entryCount ?? 0,
    },
    rejected: { basis: "ECONOMIC_MONTH", entryCount: rejected?.entryCount ?? 0 },
    evidenceMissing: {
      postedCount: postedMissing?.entryCount ?? 0,
      pendingCount: pendingMissing?.entryCount ?? 0,
    },
    byCategory: byCategory.map((row) => ({
      code: row.code,
      labelFr: row.labelFr,
      labelEn: row.labelEn,
      layer: row.layer,
      expenseMinor: minor(row.expenseMinor),
    })),
    series: seriesCodes.map((code) => ({
      periodCode: code,
      expenseMinor: minor(seriesByCode.get(code)?.expenseMinor),
      revenueMinor: minor(seriesByCode.get(code)?.revenueMinor),
    })),
  };
}

export function registerAssetFinanceReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * One vehicle's month in money. Ledger figures, so only the roles that read
   * the books get them (DECISIONS 1): the workshop sees its work orders' cost
   * lines, not this.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/assets/:assetId/finance", ...LEDGER_GATE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const params = z.object({ assetId: z.uuid() }).safeParse(req.params);
        const query = assetFinanceQuery.safeParse(req.query);
        if (!params.success || !query.success) throw invalidRequest();
        const { assetId } = params.data;

        const body = await read(async (tx) => {
          await requireScopedAsset(tx, auth, assetId);
          return loadFinance(tx, auth, assetId, query.data.periodCode);
        });
        return assetFinanceResponse.parse(body);
      } catch (error) {
        return sendReadFailure(req, reply, error, "asset finance");
      }
    },
  );
}
