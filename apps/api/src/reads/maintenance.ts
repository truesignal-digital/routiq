import {
  issueListQuery,
  issueListResponse,
  workOrderDetail,
  workOrderListQuery,
  workOrderListResponse,
  type ListSort,
} from "@routiq/contracts";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import {
  assets,
  availabilityIntervals,
  branches,
  categories,
  financialEntries,
  financialPostings,
  operationalIssues,
  workOrders,
} from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import {
  afterKeyset,
  bindText,
  bindTimestamp,
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  type KeysetColumn,
  type KeysetValue,
} from "./cursor.js";
import { serializeMinor } from "./serialize-minor.js";

const defaultIssueSort: ListSort<"reportedAt"> = {
  field: "reportedAt",
  direction: "desc",
};

type IssueSortField = "reportedAt" | "issueNumber";

const issueSortColumns: Record<IssueSortField, KeysetColumn> = {
  reportedAt: { column: operationalIssues.reportedAt, bind: bindTimestamp },
  issueNumber: { column: operationalIssues.issueNumber, bind: bindText },
};

function issueSortValue(
  field: IssueSortField,
  row: { reportedAt: Date; issueNumber: string },
): KeysetValue {
  return field === "reportedAt" ? row.reportedAt.toISOString() : row.issueNumber;
}

const defaultWorkOrderSort: ListSort<"openedAt"> = {
  field: "openedAt",
  direction: "desc",
};

type WorkOrderSortField = "openedAt" | "workOrderNumber";

const workOrderSortColumns: Record<WorkOrderSortField, KeysetColumn> = {
  openedAt: { column: workOrders.openedAt, bind: bindTimestamp },
  workOrderNumber: { column: workOrders.workOrderNumber, bind: bindText },
};

function workOrderSortValue(
  field: WorkOrderSortField,
  row: { openedAt: Date; workOrderNumber: string },
): KeysetValue {
  return field === "openedAt" ? row.openedAt.toISOString() : row.workOrderNumber;
}

function workOrderCountSql(): SQL<number> {
  return sql<number>`(
    select count(*)::integer
    from ${workOrders}
    where ${workOrders.workspaceId} = ${operationalIssues.workspaceId}
      and ${workOrders.operationalIssueId} = ${operationalIssues.id}
  )`;
}

/** The interval THIS issue opened is still open — the release is pending. */
function issueAssetUnavailableSql(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
    from ${availabilityIntervals}
    where ${availabilityIntervals.workspaceId} = ${operationalIssues.workspaceId}
      and ${availabilityIntervals.openedByIssueId} = ${operationalIssues.id}
      and ${availabilityIntervals.endedAt} is null
  )`;
}

/**
 * The WO's live posted cost, signed over the ledger statuses (POSTED +
 * REVERSED, §4.2) so a reversal pair nets to zero. The same predicate as
 * `workOrderPostedCostMinor` on the command side — a WO list and a completion
 * gate disagreeing about a total would be a bug, not a view choice.
 */
function postedCostSql(): SQL<string> {
  return sql<string>`coalesce((
    select sum(case when ${financialEntries.direction} = 'EXPENSE' then ${financialPostings.amountMinor} else -${financialPostings.amountMinor} end)
    from ${financialPostings}
    inner join ${financialEntries}
      on ${financialEntries.workspaceId} = ${financialPostings.workspaceId}
      and ${financialEntries.id} = ${financialPostings.financialEntryId}
    where ${financialPostings.workspaceId} = ${workOrders.workspaceId}
      and ${financialPostings.workOrderId} = ${workOrders.id}
      and ${financialEntries.status} in ('POSTED', 'REVERSED')
  ), 0)::text`;
}

export function registerMaintenanceReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  app.get(
    "/v1/maintenance/issues",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedQuery = issueListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }

        const { status, branchId, assetId, categoryCode, safetyCritical, cursor, limit } =
          parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultIssueSort;
        const sortColumn = issueSortColumns[sort.field];

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const decodedCursor = cursor ? decodeKeysetCursor(cursor, sort) : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          const conditions: SQL[] = [
            eq(operationalIssues.workspaceId, auth.workspaceId),
          ];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(operationalIssues.branchId, auth.branchScope));
          }
          if (branchId) conditions.push(eq(operationalIssues.branchId, branchId));
          if (assetId) conditions.push(eq(operationalIssues.assetId, assetId));
          if (status) conditions.push(eq(operationalIssues.status, status));
          if (safetyCritical !== undefined) {
            conditions.push(eq(operationalIssues.safetyCritical, safetyCritical));
          }
          if (categoryCode) conditions.push(eq(categories.code, categoryCode));
          if (decodedCursor) {
            conditions.push(
              afterKeyset(sortColumn, sort.direction, operationalIssues.id, decodedCursor),
            );
          }

          const rows = await tx
            .select({
              id: operationalIssues.id,
              issueNumber: operationalIssues.issueNumber,
              categoryCode: categories.code,
              categoryLabelFr: categories.labelFr,
              categoryLabelEn: categories.labelEn,
              assetId: operationalIssues.assetId,
              assetCode: assets.assetCode,
              branchId: operationalIssues.branchId,
              description: operationalIssues.description,
              safetyCritical: operationalIssues.safetyCritical,
              status: operationalIssues.status,
              reportedAt: operationalIssues.reportedAt,
              resolvedAt: operationalIssues.resolvedAt,
              dismissedReason: operationalIssues.dismissedReason,
              workOrderCount: workOrderCountSql(),
              assetUnavailable: issueAssetUnavailableSql(),
              rowVersion: operationalIssues.rowVersion,
            })
            .from(operationalIssues)
            .innerJoin(
              categories,
              and(
                eq(categories.workspaceId, operationalIssues.workspaceId),
                eq(categories.id, operationalIssues.categoryId),
              ),
            )
            .innerJoin(
              assets,
              and(
                eq(assets.workspaceId, operationalIssues.workspaceId),
                eq(assets.id, operationalIssues.assetId),
              ),
            )
            .where(and(...conditions))
            .orderBy(...keysetOrderBy(sortColumn, sort.direction, operationalIssues.id))
            .limit(limit + 1);

          return { rows };
        });

        if ("error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const hasNextPage = result.rows.length > limit;
        const pageRows = result.rows.slice(0, limit);
        const items = pageRows.map((row) => ({
          id: row.id,
          issueNumber: row.issueNumber,
          category: {
            code: row.categoryCode,
            labelFr: row.categoryLabelFr,
            labelEn: row.categoryLabelEn,
          },
          assetId: row.assetId,
          assetCode: row.assetCode,
          branchId: row.branchId,
          description: row.description,
          safetyCritical: row.safetyCritical,
          status: row.status,
          reportedAt: row.reportedAt.toISOString(),
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          dismissedReason: row.dismissedReason,
          workOrderCount: row.workOrderCount,
          assetUnavailable: row.assetUnavailable,
          rowVersion: row.rowVersion,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(
            sort,
            issueSortValue(sort.field, lastRow),
            lastRow.id,
          );
        }

        return issueListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "issues list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  app.get(
    "/v1/maintenance/work-orders",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedQuery = workOrderListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }

        const { status, branchId, assetId, issueId, cursor, limit } = parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultWorkOrderSort;
        const sortColumn = workOrderSortColumns[sort.field];

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const decodedCursor = cursor ? decodeKeysetCursor(cursor, sort) : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          const conditions: SQL[] = [eq(workOrders.workspaceId, auth.workspaceId)];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(workOrders.branchId, auth.branchScope));
          }
          if (branchId) conditions.push(eq(workOrders.branchId, branchId));
          if (assetId) conditions.push(eq(workOrders.assetId, assetId));
          if (status) conditions.push(eq(workOrders.status, status));
          if (issueId) conditions.push(eq(workOrders.operationalIssueId, issueId));
          if (decodedCursor) {
            conditions.push(
              afterKeyset(sortColumn, sort.direction, workOrders.id, decodedCursor),
            );
          }

          const rows = await tx
            .select({
              id: workOrders.id,
              workOrderNumber: workOrders.workOrderNumber,
              assetId: workOrders.assetId,
              assetCode: assets.assetCode,
              branchId: workOrders.branchId,
              operationalIssueId: workOrders.operationalIssueId,
              description: workOrders.description,
              status: workOrders.status,
              expectedCostMinor: workOrders.expectedCostMinor,
              postedCostMinor: postedCostSql(),
              currency: workOrders.currency,
              openedAt: workOrders.openedAt,
              completedAt: workOrders.completedAt,
              rowVersion: workOrders.rowVersion,
            })
            .from(workOrders)
            .innerJoin(
              assets,
              and(
                eq(assets.workspaceId, workOrders.workspaceId),
                eq(assets.id, workOrders.assetId),
              ),
            )
            .where(and(...conditions))
            .orderBy(...keysetOrderBy(sortColumn, sort.direction, workOrders.id))
            .limit(limit + 1);

          return { rows };
        });

        if ("error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const hasNextPage = result.rows.length > limit;
        const pageRows = result.rows.slice(0, limit);
        const items = pageRows.map((row) => ({
          id: row.id,
          workOrderNumber: row.workOrderNumber,
          assetId: row.assetId,
          assetCode: row.assetCode,
          branchId: row.branchId,
          operationalIssueId: row.operationalIssueId,
          description: row.description,
          status: row.status,
          expectedCostMinor: serializeMinor(row.expectedCostMinor),
          postedCostMinor: serializeMinor(BigInt(row.postedCostMinor)),
          currency: row.currency,
          openedAt: row.openedAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          rowVersion: row.rowVersion,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(
            sort,
            workOrderSortValue(sort.field, lastRow),
            lastRow.id,
          );
        }

        return workOrderListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "work orders list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  app.get(
    "/v1/maintenance/work-orders/:workOrderId",
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = req.auth!;
        const parsedParams = z.object({ workOrderId: z.uuid() }).safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { workOrderId } = parsedParams.data;

        const result = await inWorkspace(db, auth.workspaceId, async (tx) => {
          const conditions: SQL[] = [
            eq(workOrders.workspaceId, auth.workspaceId),
            eq(workOrders.id, workOrderId),
          ];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(workOrders.branchId, auth.branchScope));
          }

          const [header] = await tx
            .select({
              id: workOrders.id,
              workOrderNumber: workOrders.workOrderNumber,
              assetId: workOrders.assetId,
              assetCode: assets.assetCode,
              branchId: workOrders.branchId,
              branchCode: branches.code,
              operationalIssueId: workOrders.operationalIssueId,
              description: workOrders.description,
              status: workOrders.status,
              expectedCostMinor: workOrders.expectedCostMinor,
              postedCostMinor: postedCostSql(),
              currency: workOrders.currency,
              openedAt: workOrders.openedAt,
              completedAt: workOrders.completedAt,
              completionNotes: workOrders.completionNotes,
              resolveLinkedIssue: workOrders.resolveLinkedIssue,
              actualCostMinor: workOrders.actualCostMinor,
              rejectedReason: workOrders.rejectedReason,
              cancelledReason: workOrders.cancelledReason,
              createdAt: workOrders.createdAt,
              createdByCommandId: workOrders.createdByCommandId,
              rowVersion: workOrders.rowVersion,
              assetUnavailable: sql<boolean>`exists (
                select 1
                from ${availabilityIntervals}
                where ${availabilityIntervals.workspaceId} = ${workOrders.workspaceId}
                  and ${availabilityIntervals.assetId} = ${workOrders.assetId}
                  and ${availabilityIntervals.endedAt} is null
              )`,
            })
            .from(workOrders)
            .innerJoin(
              assets,
              and(
                eq(assets.workspaceId, workOrders.workspaceId),
                eq(assets.id, workOrders.assetId),
              ),
            )
            .innerJoin(
              branches,
              and(
                eq(branches.workspaceId, workOrders.workspaceId),
                eq(branches.id, workOrders.branchId),
              ),
            )
            .where(and(...conditions))
            .limit(1);

          // Out of the caller's workspace or branch scope is the same answer as
          // "no such work order" — a 403 would confirm the row exists elsewhere.
          if (!header) return undefined;

          let issue = null;
          if (header.operationalIssueId !== null) {
            const [issueRow] = await tx
              .select({
                id: operationalIssues.id,
                issueNumber: operationalIssues.issueNumber,
                status: operationalIssues.status,
                safetyCritical: operationalIssues.safetyCritical,
                description: operationalIssues.description,
              })
              .from(operationalIssues)
              .where(
                and(
                  eq(operationalIssues.workspaceId, auth.workspaceId),
                  eq(operationalIssues.id, header.operationalIssueId),
                ),
              );
            issue = issueRow ?? null;
          }

          // Per entry, the WO-attributed slice of its postings — not the whole
          // entry amount: one invoice can split across two repairs.
          const costRows = await tx
            .select({
              entryId: financialEntries.id,
              entryNumber: financialEntries.entryNumber,
              categoryCode: categories.code,
              amountMinor: sql<string>`sum(case when ${financialEntries.direction} = 'EXPENSE' then ${financialPostings.amountMinor} else -${financialPostings.amountMinor} end)::text`,
              status: financialEntries.status,
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
                eq(categories.workspaceId, financialEntries.workspaceId),
                eq(categories.id, financialEntries.categoryId),
              ),
            )
            .where(
              and(
                eq(financialPostings.workspaceId, auth.workspaceId),
                eq(financialPostings.workOrderId, workOrderId),
              ),
            )
            .groupBy(financialEntries.id, financialEntries.entryNumber, categories.code, financialEntries.status)
            .orderBy(asc(financialEntries.entryNumber), asc(financialEntries.id));

          return { header, issue, costRows };
        });

        if (!result) {
          return reply.status(404).send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }

        const { header, issue, costRows } = result;
        return workOrderDetail.parse({
          id: header.id,
          workOrderNumber: header.workOrderNumber,
          assetId: header.assetId,
          assetCode: header.assetCode,
          branchId: header.branchId,
          branchCode: header.branchCode,
          operationalIssueId: header.operationalIssueId,
          description: header.description,
          status: header.status,
          expectedCostMinor: serializeMinor(header.expectedCostMinor),
          postedCostMinor: serializeMinor(BigInt(header.postedCostMinor)),
          actualCostMinor:
            header.actualCostMinor === null ? null : serializeMinor(header.actualCostMinor),
          currency: header.currency,
          openedAt: header.openedAt.toISOString(),
          completedAt: header.completedAt?.toISOString() ?? null,
          completionNotes: header.completionNotes,
          resolveLinkedIssue: header.resolveLinkedIssue,
          rejectedReason: header.rejectedReason,
          cancelledReason: header.cancelledReason,
          createdAt: header.createdAt.toISOString(),
          createdByCommandId: header.createdByCommandId,
          rowVersion: header.rowVersion,
          issue,
          assetUnavailable: header.assetUnavailable,
          costEntries: costRows.map((row) => ({
            entryId: row.entryId,
            entryNumber: row.entryNumber,
            categoryCode: row.categoryCode,
            amountMinor: serializeMinor(BigInt(row.amountMinor)),
            status: row.status,
          })),
        });
      } catch (error) {
        req.log.error({ err: error }, "work order detail read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
