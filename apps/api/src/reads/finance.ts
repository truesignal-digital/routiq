import {
  financialEntryDetail,
  financialEntryListResponse,
  listQuery,
  pendingApprovalsResponse,
  periodsResponse,
  type ListSort,
} from "@routiq/contracts";
import { and, asc, desc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import {
  assets,
  categories,
  commands,
  financialEntries,
  financialPostings,
  postingPeriods,
} from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { pendingApprovalConditions } from "./approvals-queue.js";
import {
  afterKeyset,
  bindBigint,
  bindDate,
  bindText,
  bindTimestamp,
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  type KeysetColumn,
  type KeysetValue,
} from "./cursor.js";
import { serializeMinor } from "./serialize-minor.js";

const entrySortFields = [
  "economicDate",
  "postedAt",
  "amount",
  "entryNumber",
] as const;
type EntrySortField = (typeof entrySortFields)[number];

/** Wire-compatible with the fixed order this read shipped with. */
const defaultEntrySort: ListSort<EntrySortField> = {
  field: "postedAt",
  direction: "desc",
};

const entrySortColumns: Record<EntrySortField, KeysetColumn> = {
  economicDate: { column: financialEntries.economicDate, bind: bindDate },
  // Null until an entry posts, so the null tail is part of this ordering.
  postedAt: {
    column: financialEntries.postedAt,
    bind: bindTimestamp,
    nullable: true,
  },
  // The entry's own SIGNED total. Postings sum to it by invariant (§3.4), so
  // there is nothing to aggregate — and a reversal sorts below its original.
  amount: { column: financialEntries.amountMinor, bind: bindBigint },
  entryNumber: { column: financialEntries.entryNumber, bind: bindText },
};

interface EntrySortRow {
  economicDate: string;
  postedAt: Date | null;
  amountMinor: bigint;
  entryNumber: string;
}

function entrySortValue(field: EntrySortField, row: EntrySortRow): KeysetValue {
  switch (field) {
    case "economicDate":
      return row.economicDate;
    case "postedAt":
      return row.postedAt?.toISOString() ?? null;
    // Minor units are bigint; a string survives the round trip exactly.
    case "amount":
      return row.amountMinor.toString();
    case "entryNumber":
      return row.entryNumber;
  }
}

// Read-side list conventions live in ADR-0003: Zod-validated filters, keyset
// pagination on a stable sort key, server-bounded limits. This response keeps
// `entries` where new resources use `items` — the legacy key documented there.
const listQuerySchema = listQuery(
  {
    status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]).optional(),
    periodCode: z.string().optional(),
    assetId: z.uuid().optional(),
    branchId: z.uuid().optional(),
  },
  { sortFields: entrySortFields },
);

const approvalSortFields = ["submittedAt", "amount", "entryNumber"] as const;
type ApprovalSortField = (typeof approvalSortFields)[number];

/** Oldest first: the queue's honest order, and what this read always returned. */
const defaultApprovalSort: ListSort<ApprovalSortField> = {
  field: "submittedAt",
  direction: "asc",
};

const approvalSortColumns: Record<ApprovalSortField, KeysetColumn> = {
  submittedAt: { column: financialEntries.createdAt, bind: bindTimestamp },
  amount: { column: financialEntries.amountMinor, bind: bindBigint },
  entryNumber: { column: financialEntries.entryNumber, bind: bindText },
};

interface ApprovalSortRow {
  submittedAt: Date;
  amountMinor: bigint;
  entryNumber: string;
}

function approvalSortValue(
  field: ApprovalSortField,
  row: ApprovalSortRow,
): KeysetValue {
  switch (field) {
    case "submittedAt":
      return row.submittedAt.toISOString();
    case "amount":
      return row.amountMinor.toString();
    case "entryNumber":
      return row.entryNumber;
  }
}

/** The page size this read has always returned; kept as the default so a
 * paramless call is byte-for-byte what it was before pagination landed. */
const APPROVALS_PAGE_SIZE = 100;

const approvalsQuerySchema = listQuery(
  {},
  {
    sortFields: approvalSortFields,
    defaultLimit: APPROVALS_PAGE_SIZE,
    maxLimit: APPROVALS_PAGE_SIZE,
  },
);

export function registerFinanceReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  app.get(
    "/v1/finance/entries",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedQuery = listQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { status, periodCode, assetId, branchId, cursor, limit } =
          parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultEntrySort;
        const sortColumn = entrySortColumns[sort.field];

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const decodedCursor = cursor
            ? decodeKeysetCursor(cursor, sort)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" };
          }

          const conditions: SQL[] = [
            eq(financialEntries.workspaceId, auth.workspaceId),
          ];

          // Apply branch scope
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(financialEntries.branchId, auth.branchScope));
          }
          // Also apply branchId filter if provided (works for both ALL and scoped)
          if (branchId) {
            conditions.push(eq(financialEntries.branchId, branchId));
          }

          if (status) {
            conditions.push(eq(financialEntries.status, status));
          }

          if (periodCode) {
            conditions.push(eq(postingPeriods.periodCode, periodCode));
          }

          // EXISTS, not a join: an entry may carry several postings on the same
          // asset, and duplicated rows would corrupt the keyset page size. The
          // subquery is correlated on workspace_id as well as the entry id, so
          // it can only ever see postings inside the caller's tenant.
          if (assetId) {
            conditions.push(
              exists(
                tx
                  .select({ one: sql`1` })
                  .from(financialPostings)
                  .where(
                    and(
                      eq(
                        financialPostings.workspaceId,
                        financialEntries.workspaceId,
                      ),
                      eq(
                        financialPostings.financialEntryId,
                        financialEntries.id,
                      ),
                      eq(financialPostings.assetId, assetId),
                    ),
                  ),
              ),
            );
          }

          if (decodedCursor) {
            conditions.push(
              afterKeyset(
                sortColumn,
                sort.direction,
                financialEntries.id,
                decodedCursor,
              ),
            );
          }

          const rows = await tx
            .select({
              id: financialEntries.id,
              entryNumber: financialEntries.entryNumber,
              direction: financialEntries.direction,
              status: financialEntries.status,
              categoryCode: categories.code,
              categoryLabelFr: categories.labelFr,
              categoryLabelEn: categories.labelEn,
              amountMinor: financialEntries.amountMinor,
              currency: financialEntries.currency,
              economicDate: financialEntries.economicDate,
              postingPeriodCode: postingPeriods.periodCode,
              isLatePosting: financialEntries.isLatePosting,
              branchId: financialEntries.branchId,
              counterpartyName: financialEntries.counterpartyName,
              paymentMethod: financialEntries.paymentMethod,
              estimateStatus: financialEntries.estimateStatus,
              postedAt: financialEntries.postedAt,
              rowVersion: financialEntries.rowVersion,
            })
            .from(financialEntries)
            .innerJoin(
              categories,
              and(
                eq(categories.workspaceId, financialEntries.workspaceId),
                eq(categories.id, financialEntries.categoryId),
              ),
            )
            .leftJoin(
              postingPeriods,
              and(
                eq(postingPeriods.workspaceId, financialEntries.workspaceId),
                eq(postingPeriods.id, financialEntries.postingPeriodId),
              ),
            )
            .where(and(...conditions))
            .orderBy(...keysetOrderBy(sortColumn, sort.direction, financialEntries.id))
            // One extra row is the has-next probe, never returned.
            .limit(limit + 1);

          return { rows };
        });

        if (result && "error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const { rows } = result || { rows: [] };
        const hasNextPage = rows.length > limit;
        const entries = rows.slice(0, limit).map((row) => ({
          id: row.id,
          entryNumber: row.entryNumber,
          direction: row.direction,
          status: row.status,
          category: {
            code: row.categoryCode,
            labelFr: row.categoryLabelFr,
            labelEn: row.categoryLabelEn,
          },
          amountMinor: serializeMinor(row.amountMinor),
          currency: row.currency,
          economicDate: row.economicDate,
          postingPeriodCode: row.postingPeriodCode ?? null,
          isLatePosting: row.isLatePosting,
          branchId: row.branchId,
          counterpartyName: row.counterpartyName,
          paymentMethod: row.paymentMethod,
          estimateStatus: row.estimateStatus,
          postedAt: row.postedAt?.toISOString() ?? null,
          rowVersion: row.rowVersion,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && entries.length > 0) {
          // Encoded off the raw row: the mapped item has already lost the
          // bigint amount and the Date to their wire forms.
          const lastRow = rows[entries.length - 1]!;
          nextCursor = encodeKeysetCursor(
            sort,
            entrySortValue(sort.field, lastRow),
            lastRow.id,
          );
        }

        return financialEntryListResponse.parse({ entries, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "finance entries list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  app.get(
    "/v1/finance/entries/:entryId",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedParams = z.object({ entryId: z.uuid() }).safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { entryId } = parsedParams.data;

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const [entry] = await tx
            .select({
              id: financialEntries.id,
              entryNumber: financialEntries.entryNumber,
              direction: financialEntries.direction,
              status: financialEntries.status,
              categoryId: financialEntries.categoryId,
              amountMinor: financialEntries.amountMinor,
              currency: financialEntries.currency,
              economicDate: financialEntries.economicDate,
              postingPeriodId: financialEntries.postingPeriodId,
              isLatePosting: financialEntries.isLatePosting,
              branchId: financialEntries.branchId,
              counterpartyName: financialEntries.counterpartyName,
              description: financialEntries.description,
              paymentMethod: financialEntries.paymentMethod,
              paymentReference: financialEntries.paymentReference,
              sourceReference: financialEntries.sourceReference,
              estimateStatus: financialEntries.estimateStatus,
              rejectedReason: financialEntries.rejectedReason,
              reversesEntryId: financialEntries.reversesEntryId,
              postedAt: financialEntries.postedAt,
              rowVersion: financialEntries.rowVersion,
            })
            .from(financialEntries)
            .where(
              and(
                eq(financialEntries.workspaceId, auth.workspaceId),
                eq(financialEntries.id, entryId),
              ),
            );

          if (
            !entry ||
            (auth.branchScope !== "ALL" && !auth.branchScope.includes(entry.branchId))
          ) {
            return undefined;
          }

          const [category] = await tx
            .select({
              labelFr: categories.labelFr,
              labelEn: categories.labelEn,
              code: categories.code,
            })
            .from(categories)
            .where(
              and(
                eq(categories.workspaceId, auth.workspaceId),
                eq(categories.id, entry.categoryId),
              ),
            );

          let periodCode: string | null = null;
          if (entry.postingPeriodId) {
            const [period] = await tx
              .select({ periodCode: postingPeriods.periodCode })
              .from(postingPeriods)
              .where(eq(postingPeriods.id, entry.postingPeriodId));
            periodCode = period?.periodCode ?? null;
          }

          const postingsRows = await tx
            .select({
              lineNo: financialPostings.lineNo,
              amountMinor: financialPostings.amountMinor,
              assetId: financialPostings.assetId,
              assetCode: assets.assetCode,
              assetAttribution: financialPostings.assetAttribution,
              categoryId: financialPostings.categoryId,
              categoryLabelFr: categories.labelFr,
              categoryLabelEn: categories.labelEn,
              categoryCode: categories.code,
            })
            .from(financialPostings)
            .leftJoin(
              assets,
              and(
                eq(assets.workspaceId, financialPostings.workspaceId),
                eq(assets.id, financialPostings.assetId),
              ),
            )
            .leftJoin(
              categories,
              and(
                eq(categories.workspaceId, financialPostings.workspaceId),
                eq(categories.id, financialPostings.categoryId),
              ),
            )
            .where(eq(financialPostings.financialEntryId, entryId))
            .orderBy(asc(financialPostings.lineNo));

          let reversedByEntryId: string | null = null;
          const [reversedByEntry] = await tx
            .select({ id: financialEntries.id })
            .from(financialEntries)
            .where(
              and(
                eq(financialEntries.workspaceId, auth.workspaceId),
                eq(financialEntries.reversesEntryId, entryId),
              ),
            );
          if (reversedByEntry) {
            reversedByEntryId = reversedByEntry.id;
          }

          return {
            entry,
            category,
            periodCode,
            postings: postingsRows,
            reversedByEntryId,
          };
        });

        if (!result) {
          return reply.status(404).send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }

        const { entry, category, periodCode, postings, reversedByEntryId } = result;

        const mappedPostings = postings.map((p) => ({
          lineNo: p.lineNo,
          amountMinor: serializeMinor(p.amountMinor),
          assetId: p.assetId,
          assetCode: p.assetCode ?? null,
          assetAttribution: p.assetAttribution,
          category: {
            code: p.categoryCode,
            labelFr: p.categoryLabelFr,
            labelEn: p.categoryLabelEn,
          },
        }));

        const response = {
          id: entry.id,
          entryNumber: entry.entryNumber,
          direction: entry.direction,
          status: entry.status,
          category: {
            code: category?.code ?? entry.categoryId,
            labelFr: category?.labelFr ?? entry.categoryId,
            labelEn: category?.labelEn ?? entry.categoryId,
          },
          amountMinor: serializeMinor(entry.amountMinor),
          currency: entry.currency,
          economicDate: entry.economicDate,
          postingPeriodCode: periodCode ?? null,
          isLatePosting: entry.isLatePosting,
          branchId: entry.branchId,
          counterpartyName: entry.counterpartyName,
          paymentMethod: entry.paymentMethod,
          estimateStatus: entry.estimateStatus,
          postedAt: entry.postedAt?.toISOString() ?? null,
          rowVersion: entry.rowVersion,
          description: entry.description,
          paymentReference: entry.paymentReference,
          sourceReference: entry.sourceReference,
          rejectedReason: entry.rejectedReason,
          reversesEntryId: entry.reversesEntryId,
          reversedByEntryId,
          postings: mappedPostings,
        };

        return financialEntryDetail.parse(response);
      } catch (error) {
        req.log.error({ err: error }, "finance entry detail read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  app.get(
    "/v1/finance/approvals",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedQuery = approvalsQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { cursor, limit } = parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultApprovalSort;
        const sortColumn = approvalSortColumns[sort.field];

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const decodedCursor = cursor
            ? decodeKeysetCursor(cursor, sort)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          // Shared with the dashboard's pendingApprovals count — one definition
          // of the queue, so the two can never disagree on screen.
          const conditions = pendingApprovalConditions(auth);

          // Counts the queue, not the page: the cursor never reaches this.
          const [countResult] = await tx
            .select({ count: sql<number>`count(*)::integer` })
            .from(financialEntries)
            .where(and(...conditions));
          const total = countResult?.count ?? 0;

          const pageConditions = decodedCursor
            ? [
                ...conditions,
                afterKeyset(
                  sortColumn,
                  sort.direction,
                  financialEntries.id,
                  decodedCursor,
                ),
              ]
            : conditions;

          const rows = await tx
            .select({
              id: financialEntries.id,
              entryNumber: financialEntries.entryNumber,
              direction: financialEntries.direction,
              status: financialEntries.status,
              categoryCode: categories.code,
              categoryLabelFr: categories.labelFr,
              categoryLabelEn: categories.labelEn,
              amountMinor: financialEntries.amountMinor,
              currency: financialEntries.currency,
              economicDate: financialEntries.economicDate,
              postingPeriodCode: postingPeriods.periodCode,
              isLatePosting: financialEntries.isLatePosting,
              branchId: financialEntries.branchId,
              counterpartyName: financialEntries.counterpartyName,
              paymentMethod: financialEntries.paymentMethod,
              estimateStatus: financialEntries.estimateStatus,
              postedAt: financialEntries.postedAt,
              rowVersion: financialEntries.rowVersion,
              submittedByPrincipalId: commands.initiatedByPrincipalId,
              submittedAt: financialEntries.createdAt,
            })
            .from(financialEntries)
            .innerJoin(
              categories,
              and(
                eq(categories.workspaceId, financialEntries.workspaceId),
                eq(categories.id, financialEntries.categoryId),
              ),
            )
            .leftJoin(
              postingPeriods,
              and(
                eq(postingPeriods.workspaceId, financialEntries.workspaceId),
                eq(postingPeriods.id, financialEntries.postingPeriodId),
              ),
            )
            .leftJoin(
              commands,
              eq(commands.id, financialEntries.createdByCommandId),
            )
            .where(and(...pageConditions))
            .orderBy(...keysetOrderBy(sortColumn, sort.direction, financialEntries.id))
            // One extra row is the has-next probe, never returned.
            .limit(limit + 1);

          return { rows, total };
        });

        if (result && "error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const { rows, total } = result || { rows: [], total: 0 };
        const hasNextPage = rows.length > limit;
        const pageRows = rows.slice(0, limit);

        const entries = pageRows.map((row) => ({
          id: row.id,
          entryNumber: row.entryNumber,
          direction: row.direction,
          status: row.status,
          category: {
            code: row.categoryCode,
            labelFr: row.categoryLabelFr,
            labelEn: row.categoryLabelEn,
          },
          amountMinor: serializeMinor(row.amountMinor),
          currency: row.currency,
          economicDate: row.economicDate,
          postingPeriodCode: row.postingPeriodCode ?? null,
          isLatePosting: row.isLatePosting,
          branchId: row.branchId,
          counterpartyName: row.counterpartyName,
          paymentMethod: row.paymentMethod,
          estimateStatus: row.estimateStatus,
          postedAt: row.postedAt?.toISOString() ?? null,
          rowVersion: row.rowVersion,
          submittedByPrincipalId: row.submittedByPrincipalId,
          submittedAt: row.submittedAt.toISOString(),
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(
            sort,
            approvalSortValue(sort.field, lastRow),
            lastRow.id,
          );
        }

        return pendingApprovalsResponse.parse({ entries, nextCursor, total });
      } catch (error) {
        req.log.error({ err: error }, "finance approvals read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  app.get(
    "/v1/finance/periods",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const rows = await tx
            .select({
              id: postingPeriods.id,
              periodCode: postingPeriods.periodCode,
              status: postingPeriods.status,
              lockedAt: postingPeriods.lockedAt,
              rowVersion: postingPeriods.rowVersion,
              entryCount: sql<number>`count(distinct ${financialEntries.id})::integer`,
            })
            .from(postingPeriods)
            .leftJoin(
              financialEntries,
              and(
                eq(financialEntries.workspaceId, postingPeriods.workspaceId),
                eq(financialEntries.postingPeriodId, postingPeriods.id),
                eq(financialEntries.status, "POSTED"),
              ),
            )
            .where(eq(postingPeriods.workspaceId, auth.workspaceId))
            .groupBy(postingPeriods.id, postingPeriods.periodCode, postingPeriods.status, postingPeriods.lockedAt, postingPeriods.rowVersion)
            .orderBy(desc(postingPeriods.periodCode));

          return { rows };
        });

        const { rows } = result || { rows: [] };

        const periods = rows.map((row) => ({
          periodCode: row.periodCode,
          status: row.status,
          lockedAt: row.lockedAt?.toISOString() ?? null,
          entryCount: row.entryCount,
          rowVersion: row.rowVersion,
        }));

        return periodsResponse.parse({ periods });
      } catch (error) {
        req.log.error({ err: error }, "finance periods read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
