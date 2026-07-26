import {
  financialEntryDetail,
  financialEntryListResponse,
  pendingApprovalsResponse,
  periodsResponse,
} from "@routiq/contracts";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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
import { serializeMinor } from "./serialize-minor.js";

const listQuerySchema = z.object({
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]).optional(),
  periodCode: z.string().optional(),
  assetId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  cursor: z.string().optional(),
});

const cursorSchema = z.object({
  postedAt: z.string().nullable(),
  id: z.uuid(),
});

type FinanceCursor = z.infer<typeof cursorSchema>;

function decodeCursor(cursor: string): FinanceCursor | undefined {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = cursorSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(cursor: FinanceCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

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
        const { status, periodCode, assetId, branchId, cursor } = parsedQuery.data;

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
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

          // Keyset pagination cursor condition
          if (decodedCursor) {
            const postedAt = decodedCursor.postedAt ? new Date(decodedCursor.postedAt) : null;
            if (postedAt === null) {
              // NULL postedAt cursor: get entries with NULL postedAt and id > cursor.id
              conditions.push(
                and(isNull(financialEntries.postedAt), sql`${financialEntries.id} > ${decodedCursor.id}`)!,
              );
            } else {
              // Non-null cursor: postedAt < c OR (postedAt = c AND id > c.id) OR postedAt IS NULL
              conditions.push(
                or(
                  sql`${financialEntries.postedAt} < ${postedAt}`,
                  and(eq(financialEntries.postedAt, postedAt), sql`${financialEntries.id} > ${decodedCursor.id}`),
                  isNull(financialEntries.postedAt),
                )!,
              );
            }
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
            .orderBy(sql`${financialEntries.postedAt} desc nulls last`, asc(financialEntries.id))
            .limit(51);

          return { rows };
        });

        if (result && "error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const { rows } = result || { rows: [] };
        const hasNextPage = rows.length > 50;
        const entries = rows.slice(0, 50).map((row) => ({
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
          const lastEntry = entries[entries.length - 1]!;
          nextCursor = encodeCursor({ postedAt: lastEntry.postedAt, id: lastEntry.id });
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
          assetId: p.assetId ?? undefined,
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

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const conditions = [
            eq(financialEntries.workspaceId, auth.workspaceId),
            eq(financialEntries.status, "SUBMITTED"),
          ];

          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(financialEntries.branchId, auth.branchScope));
          }

          const [countResult] = await tx
            .select({ count: sql<number>`count(*)::integer` })
            .from(financialEntries)
            .where(and(...conditions));
          const total = countResult?.count ?? 0;

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
            .where(and(...conditions))
            .orderBy(asc(financialEntries.createdAt))
            .limit(100);

          return { rows, total };
        });

        const { rows, total } = result || { rows: [], total: 0 };

        const entries = rows.map((row) => ({
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

        return pendingApprovalsResponse.parse({ entries, total });
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
