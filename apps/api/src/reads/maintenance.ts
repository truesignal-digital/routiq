import {
  issueDetail,
  issueListQuery,
  issueListResponse,
  maintenanceSummary,
  maintenanceSummaryQuery,
  workOrderDetail,
  workOrderListQuery,
  workOrderListResponse,
  type HistoryActor,
  type ListSort,
  type ModuleCode,
} from "@routiq/contracts";
import { and, asc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import {
  ISSUE_CLOSURE_EVENTS,
  WORK_ORDER_COMPLETION_EVENTS,
} from "../commands/work-order-lookup.js";
import {
  assetAvailabilityIntervals,
  assets,
  auditEvents,
  branches,
  commands,
  financialEntries,
  financialPostings,
  operationalIssues,
  principals,
  workOrders,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { lastEventActors, toActor } from "./actors.js";
import { noteCodeSql, noteSql } from "./history.js";
import { commandArtifacts } from "./record-artifacts.js";
import { invalidRequest, notFound, sendReadFailure } from "./read-gate.js";
import {
  afterKeyset,
  bindTimestampText,
  decodeTimestampCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  microsecondKey,
  type KeysetColumn,
} from "./cursor.js";
import { serializeMinor } from "./serialize-minor.js";
import {
  costToCome,
  parseActualCost,
  workOrderActualCostSql,
  workOrderCostToComeColumns,
  workOrderMoneyVisibility,
  type CostToComeFacts,
  type WorkOrderMoneyVisibility,
} from "./work-order-cost.js";
import { ANY_ROLE, defineRead } from "./define-read.js";

/**
 * Newest first, always — both maintenance queues read that way and neither
 * offers the client a sort. The cursor still carries the ordering, because
 * `decodeKeysetCursor` refuses a boundary minted under any other one.
 */
/** How far back "average days to repair" looks: a quarter of completions. */
const REPAIR_WINDOW_DAYS = 90;

const workOrderSort: ListSort<"createdAt"> = {
  field: "createdAt",
  direction: "desc",
};

const issueSort: ListSort<"reportedAt"> = {
  field: "reportedAt",
  direction: "desc",
};

/**
 * A work order has no timestamp of its own: the row is stamped by the command
 * that wrote it, so the queue orders on that receipt's execution time. The FK is
 * NOT NULL, which is what lets the join below be an inner one. Postgres stamps
 * that time to the microsecond, so the cursor carries it at that precision.
 */
const workOrderCreatedAtColumn: KeysetColumn = {
  column: commands.executedAt,
  bind: bindTimestampText,
};

const issueReportedAtColumn: KeysetColumn = {
  column: operationalIssues.reportedAt,
  bind: bindTimestampText,
};

function serializeOptionalMinor(value: bigint | null): number | null {
  return value === null ? null : serializeMinor(value);
}

/**
 * A work order's amounts and its cost still to come (#82), each null when the
 * caller may not read it. Null, never zero: a hidden figure must not read as a
 * free repair.
 */
function workOrderAmounts(
  visible: WorkOrderMoneyVisibility,
  row: CostToComeFacts & {
    expectedCostMinor: bigint | null;
    actualCostMinor: string | null;
  },
) {
  return {
    expectedCostMinor: visible.estimate ? serializeOptionalMinor(row.expectedCostMinor) : null,
    ...(visible.actual
      ? {
          actualCostMinor: serializeOptionalMinor(parseActualCost(row.actualCostMinor)),
          declaredCostMinor: serializeOptionalMinor(row.declaredCostMinor),
          costToCome: costToCome(row),
        }
      : { actualCostMinor: null, declaredCostMinor: null, costToCome: null }),
  };
}

/** Statuses in which a completion stands, so its declarer is a live maker. */
const COMPLETION_DECLARED = new Set(["COMPLETION_SUBMITTED", "COMPLETED"]);

/**
 * Who declared each order complete, for the orders whose completion stands. A
 * completion sent back returns the order to APPROVED, and its old declarer is
 * nobody's maker until the work is declared again.
 */
async function completersOf(
  tx: TenantTx,
  workspaceId: string,
  orders: ReadonlyArray<{ id: string; status: string }>,
): Promise<Map<string, HistoryActor>> {
  return lastEventActors(
    tx,
    workspaceId,
    "work_order",
    orders.filter((order) => COMPLETION_DECLARED.has(order.status)).map((order) => order.id),
    WORK_ORDER_COMPLETION_EVENTS,
  );
}

export function registerMaintenanceReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * The work-order queue. Neither work orders nor issues carry a branch column,
   * so the branch lens — and the `branchId` filter — resolve through the asset,
   * which is why every query in this file joins the fleet.
   */
  /**
   * The Maintenance overview. Every count runs over assets in the caller's
   * branch scope (a work order or an issue has no branch of its own), so the
   * tiles cover exactly what the two lists under them can show.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/maintenance/summary", module: "MAINTENANCE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = maintenanceSummaryQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { branchId } = parsedQuery.data;

        const assetConditions: SQL[] = [eq(assets.workspaceId, auth.workspaceId)];
        if (auth.branchScope !== "ALL") {
          assetConditions.push(inArray(assets.branchId, auth.branchScope));
        }
        if (branchId) assetConditions.push(eq(assets.branchId, branchId));
        const scopedAssetIds = sql`(select ${assets.id} from ${assets} where ${and(...assetConditions)})`;

        const [counts] = await read((tx) =>
          tx.execute<{
            open_issues: number;
            open_safety_critical: number;
            grounded: number;
            approved_work_orders: number;
            average_repair_days: string | null;
            repairs_counted: number;
          }>(sql`
            select
              (select count(*)::int from ${operationalIssues}
                where ${operationalIssues.workspaceId} = ${auth.workspaceId}
                  and ${operationalIssues.status} = 'OPEN'
                  and ${operationalIssues.assetId} in ${scopedAssetIds}) as open_issues,
              (select count(*)::int from ${operationalIssues}
                where ${operationalIssues.workspaceId} = ${auth.workspaceId}
                  and ${operationalIssues.status} = 'OPEN'
                  and ${operationalIssues.safetyCritical}
                  and ${operationalIssues.assetId} in ${scopedAssetIds}) as open_safety_critical,
              (select count(distinct ${assetAvailabilityIntervals.assetId})::int
                from ${assetAvailabilityIntervals}
                where ${assetAvailabilityIntervals.workspaceId} = ${auth.workspaceId}
                  and ${assetAvailabilityIntervals.closedAt} is null
                  and ${assetAvailabilityIntervals.assetId} in ${scopedAssetIds}) as grounded,
              (select count(*)::int from ${workOrders}
                where ${workOrders.workspaceId} = ${auth.workspaceId}
                  and ${workOrders.status} = 'APPROVED'
                  and ${workOrders.assetId} in ${scopedAssetIds}) as approved_work_orders,
              repairs.average_repair_days,
              repairs.repairs_counted
            from (
              select
                round(avg(extract(epoch from (${workOrders.completedAt} - ${commands.executedAt})) / 86400)::numeric, 1)::text
                  as average_repair_days,
                count(*)::int as repairs_counted
              from ${workOrders}
              inner join ${commands} on ${commands.id} = ${workOrders.createdByCommandId}
              where ${workOrders.workspaceId} = ${auth.workspaceId}
                and ${workOrders.status} = 'COMPLETED'
                and ${workOrders.completedAt} >= now() - make_interval(days => ${REPAIR_WINDOW_DAYS}::int)
                and ${workOrders.assetId} in ${scopedAssetIds}
            ) as repairs
          `),
        ).then((result) => result.rows);

        return maintenanceSummary.parse({
          openIssues: counts?.open_issues ?? 0,
          openSafetyCritical: counts?.open_safety_critical ?? 0,
          grounded: counts?.grounded ?? 0,
          approvedWorkOrders: counts?.approved_work_orders ?? 0,
          averageRepairDays:
            counts?.average_repair_days == null ? null : Number(counts.average_repair_days),
          repairsCounted: counts?.repairs_counted ?? 0,
          repairWindowDays: REPAIR_WINDOW_DAYS,
        });
      } catch (error) {
        req.log.error({ err: error }, "maintenance summary read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/work-orders", module: "MAINTENANCE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, modules, read }) => {
      try {
        const parsedQuery = workOrderListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { status, branchId, assetId, cursor, limit } = parsedQuery.data;

        const result = await read(async (tx) => {
          const decodedCursor = cursor
            ? decodeTimestampCursor(cursor, workOrderSort)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          const conditions: SQL[] = [
            eq(workOrders.workspaceId, auth.workspaceId),
          ];
          // Branch scope comes from the session, never the client; a branchId
          // filter narrows inside it and can never widen it.
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(assets.branchId, auth.branchScope));
          }
          if (branchId) conditions.push(eq(assets.branchId, branchId));
          if (status) conditions.push(eq(workOrders.status, status));
          if (assetId) conditions.push(eq(workOrders.assetId, assetId));
          if (decodedCursor) {
            conditions.push(
              afterKeyset(
                workOrderCreatedAtColumn,
                workOrderSort.direction,
                workOrders.id,
                decodedCursor,
              ),
            );
          }

          const rows = await tx
            .select({
              id: workOrders.id,
              status: workOrders.status,
              description: workOrders.description,
              assetId: workOrders.assetId,
              assetCode: assets.assetCode,
              registrationNumber: assets.registrationNumber,
              branchId: assets.branchId,
              branchCode: branches.code,
              branchName: branches.name,
              expectedCostMinor: workOrders.expectedCostMinor,
              actualCostMinor: workOrderActualCostSql(),
              declaredCostMinor: workOrders.declaredCostMinor,
              costOutcome: workOrders.costOutcome,
              ...workOrderCostToComeColumns(),
              currency: workOrders.currency,
              issueId: workOrders.issueId,
              safetyCritical: operationalIssues.safetyCritical,
              createdAt: commands.executedAt,
              createdAtKey: microsecondKey(commands.executedAt),
              completedAt: workOrders.completedAt,
              cancelledAt: workOrders.cancelledAt,
              rejectedAt: workOrders.rejectedAt,
              rowVersion: workOrders.rowVersion,
              creatorPrincipalId: commands.tenantActorPrincipalId,
              creatorDisplayName: principals.displayName,
              creatorScope: commands.scope,
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
                eq(branches.workspaceId, assets.workspaceId),
                eq(branches.id, assets.branchId),
              ),
            )
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, workOrders.workspaceId),
                eq(commands.id, workOrders.createdByCommandId),
              ),
            )
            .leftJoin(
              operationalIssues,
              and(
                eq(operationalIssues.workspaceId, workOrders.workspaceId),
                eq(operationalIssues.id, workOrders.issueId),
              ),
            )
            .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
            .where(and(...conditions))
            .orderBy(
              ...keysetOrderBy(
                workOrderCreatedAtColumn,
                workOrderSort.direction,
                workOrders.id,
              ),
            )
            .limit(limit + 1);

          const completers = await completersOf(tx, auth.workspaceId, rows.slice(0, limit));
          return { rows, completers };
        });

        if ("error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const hasNextPage = result.rows.length > limit;
        const pageRows = result.rows.slice(0, limit);
        const items = pageRows.map((row) => ({
          id: row.id,
          status: row.status,
          description: row.description,
          asset: {
            id: row.assetId,
            assetCode: row.assetCode,
            registrationNumber: row.registrationNumber,
          },
          branch: {
            id: row.branchId,
            code: row.branchCode,
            name: row.branchName,
          },
          ...workOrderAmounts(workOrderMoneyVisibility(auth, modules), row),
          costOutcome: row.costOutcome,
          currency: row.currency,
          issue:
            row.issueId === null
              ? null
              : { id: row.issueId, safetyCritical: row.safetyCritical ?? false },
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          cancelledAt: row.cancelledAt?.toISOString() ?? null,
          rejectedAt: row.rejectedAt?.toISOString() ?? null,
          rowVersion: row.rowVersion,
          createdBy: toActor({
            principalId: row.creatorPrincipalId,
            displayName: row.creatorDisplayName,
            scope: row.creatorScope,
          }),
          completedBy: result.completers.get(row.id) ?? null,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(workOrderSort, lastRow.createdAtKey, lastRow.id);
        }

        return workOrderListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "work orders list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  /**
   * One work order, its chronologie and what it cost. The timeline is assembled
   * from the audit trail rather than from the row's own columns: the row holds
   * only the current state, while who approved the spend and who signed the
   * truck back into service exist nowhere else.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/work-orders/:workOrderId", module: "MAINTENANCE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, modules, read }) => {
      try {
        const parsedParams = z
          .object({ workOrderId: z.uuid() })
          .safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { workOrderId } = parsedParams.data;

        const result = await read(async (tx) => {
          const conditions: SQL[] = [
            eq(workOrders.workspaceId, auth.workspaceId),
            eq(workOrders.id, workOrderId),
          ];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(assets.branchId, auth.branchScope));
          }

          const [header] = await tx
            .select({
              id: workOrders.id,
              status: workOrders.status,
              description: workOrders.description,
              assetId: workOrders.assetId,
              assetCode: assets.assetCode,
              registrationNumber: assets.registrationNumber,
              branchId: assets.branchId,
              branchCode: branches.code,
              branchName: branches.name,
              expectedCostMinor: workOrders.expectedCostMinor,
              actualCostMinor: workOrderActualCostSql(),
              declaredCostMinor: workOrders.declaredCostMinor,
              costOutcome: workOrders.costOutcome,
              ...workOrderCostToComeColumns(),
              currency: workOrders.currency,
              issueId: workOrders.issueId,
              safetyCritical: operationalIssues.safetyCritical,
              summary: workOrders.summary,
              cancelReason: workOrders.cancelReason,
              rejectReason: workOrders.rejectReason,
              completionRejectReason: workOrders.completionRejectReason,
              resolveLinkedIssue: workOrders.resolveLinkedIssue,
              createdAt: commands.executedAt,
              createdByCommandId: workOrders.createdByCommandId,
              completedAt: workOrders.completedAt,
              cancelledAt: workOrders.cancelledAt,
              rejectedAt: workOrders.rejectedAt,
              rowVersion: workOrders.rowVersion,
              creatorPrincipalId: commands.tenantActorPrincipalId,
              creatorDisplayName: principals.displayName,
              creatorScope: commands.scope,
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
                eq(branches.workspaceId, assets.workspaceId),
                eq(branches.id, assets.branchId),
              ),
            )
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, workOrders.workspaceId),
                eq(commands.id, workOrders.createdByCommandId),
              ),
            )
            .leftJoin(
              operationalIssues,
              and(
                eq(operationalIssues.workspaceId, workOrders.workspaceId),
                eq(operationalIssues.id, workOrders.issueId),
              ),
            )
            .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
            .where(and(...conditions))
            .limit(1);

          if (!header) return undefined;
          const completers = await completersOf(tx, auth.workspaceId, [header]);

          // A transaction owns one pg connection; keep the child reads
          // sequential so the driver never receives overlapping queries.
          const eventRows = await tx
            .select({
              eventId: auditEvents.id,
              kind: auditEvents.eventType,
              occurredAt: auditEvents.occurredAt,
              note: noteSql(),
              noteCode: noteCodeSql(),
              scope: auditEvents.scope,
              // The generated masking column, not `actor_principal_id`: it is
              // NULL for PLATFORM events, so the principals join finds nothing
              // and the vendor operator's identity never crosses the tenant line.
              actorPrincipalId: auditEvents.tenantActorPrincipalId,
              actorDisplayName: principals.displayName,
            })
            .from(auditEvents)
            .leftJoin(
              principals,
              eq(principals.id, auditEvents.tenantActorPrincipalId),
            )
            .where(
              and(
                eq(auditEvents.workspaceId, auth.workspaceId),
                eq(auditEvents.entityType, "work_order"),
                eq(auditEvents.entityId, workOrderId),
              ),
            )
            .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));

          if (!workOrderMoneyVisibility(auth, modules).actual) {
            return {
              header,
              eventRows,
              costRows: null,
              otherBranchesCostMinor: null,
              completedBy: completers.get(header.id) ?? null,
            };
          }

          // A cost line is a financial record: its entry's branch is read
          // against the actor's scope, whatever branch the truck is in now.
          // REJECTED spend was refused and is not a cost of this repair, nor
          // is revenue that named the order before #432 refused it.
          const costConditions: SQL[] = [
            eq(financialPostings.workspaceId, auth.workspaceId),
            eq(financialPostings.workOrderId, workOrderId),
            eq(financialPostings.direction, "EXPENSE"),
            inArray(financialEntries.status, ["POSTED", "REVERSED", "SUBMITTED"]),
          ];
          // The lines outside the reader's branches still count in the actual
          // cost (#81). They come back as one sum and nothing else (#643), so
          // the list adds up without exposing another branch's records.
          let otherBranchesCostMinor = 0n;
          if (auth.branchScope !== "ALL") {
            const [other] = await tx
              .select({
                sum: sql<string>`coalesce(sum(${financialPostings.amountMinor}), 0)::text`,
              })
              .from(financialPostings)
              .innerJoin(
                financialEntries,
                and(
                  eq(financialEntries.workspaceId, financialPostings.workspaceId),
                  eq(financialEntries.id, financialPostings.financialEntryId),
                ),
              )
              .where(and(...costConditions, notInArray(financialEntries.branchId, auth.branchScope)));
            otherBranchesCostMinor = BigInt(other?.sum ?? "0");
            costConditions.push(inArray(financialEntries.branchId, auth.branchScope));
          }
          const costRows = await tx
            .select({
              postingId: financialPostings.id,
              entryId: financialEntries.id,
              entryNumber: financialEntries.entryNumber,
              description: financialEntries.description,
              amountMinor: financialPostings.amountMinor,
              currency: financialEntries.currency,
              economicDate: financialPostings.economicDate,
              entryStatus: financialEntries.status,
            })
            .from(financialPostings)
            .innerJoin(
              financialEntries,
              and(
                eq(financialEntries.workspaceId, financialPostings.workspaceId),
                eq(financialEntries.id, financialPostings.financialEntryId),
              ),
            )
            .where(and(...costConditions))
            .orderBy(
              asc(financialPostings.economicDate),
              asc(financialEntries.entryNumber),
              asc(financialPostings.lineNo),
            );

          return {
            header,
            eventRows,
            costRows,
            otherBranchesCostMinor,
            completedBy: completers.get(header.id) ?? null,
          };
        });

        if (!result) {
          return reply
            .status(404)
            .send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }

        const { header, eventRows, costRows, otherBranchesCostMinor, completedBy } = result;
        const costLine = (line: NonNullable<typeof costRows>[number]) => ({
          ...line,
          amountMinor: serializeMinor(line.amountMinor),
        });
        return workOrderDetail.parse({
          id: header.id,
          status: header.status,
          description: header.description,
          asset: {
            id: header.assetId,
            assetCode: header.assetCode,
            registrationNumber: header.registrationNumber,
          },
          branch: {
            id: header.branchId,
            code: header.branchCode,
            name: header.branchName,
          },
          ...workOrderAmounts(workOrderMoneyVisibility(auth, modules), header),
          costOutcome: header.costOutcome,
          currency: header.currency,
          issue:
            header.issueId === null
              ? null
              : {
                  id: header.issueId,
                  safetyCritical: header.safetyCritical ?? false,
                },
          summary: header.summary,
          cancelReason: header.cancelReason,
          rejectReason: header.rejectReason,
          completionRejectReason: header.completionRejectReason,
          resolveLinkedIssue: header.resolveLinkedIssue,
          createdAt: header.createdAt.toISOString(),
          createdByCommandId: header.createdByCommandId,
          completedAt: header.completedAt?.toISOString() ?? null,
          cancelledAt: header.cancelledAt?.toISOString() ?? null,
          rejectedAt: header.rejectedAt?.toISOString() ?? null,
          rowVersion: header.rowVersion,
          createdBy: toActor({
            principalId: header.creatorPrincipalId,
            displayName: header.creatorDisplayName,
            scope: header.creatorScope,
          }),
          completedBy,
          chronologie: eventRows.map((event) => ({
            eventId: event.eventId,
            kind: event.kind,
            occurredAt: event.occurredAt.toISOString(),
            note: event.note,
            noteCode: event.noteCode,
            actor: {
              principalId: event.actorPrincipalId,
              displayName: event.actorDisplayName,
              scope: event.scope,
            },
          })),
          costLines:
            costRows?.filter((line) => line.entryStatus !== "SUBMITTED").map(costLine) ?? null,
          pendingCostLines:
            costRows?.filter((line) => line.entryStatus === "SUBMITTED").map(costLine) ?? null,
          otherBranchesCostMinor: serializeOptionalMinor(otherBranchesCostMinor),
        });
      } catch (error) {
        req.log.error({ err: error }, "work order detail read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  /**
   * The signalements queue. An issue's own state is OPEN, RESOLVED or
   * DISMISSED; its work orders and whether the truck is still grounded live
   * elsewhere — the availability intervals — and are resolved here so the
   * screen renders a row without a second round trip on 2G.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/issues", module: "MAINTENANCE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = issueListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { branchId, assetId, safetyCritical, status, cursor, limit } =
          parsedQuery.data;

        const result = await read(async (tx) => {
          const decodedCursor = cursor
            ? decodeTimestampCursor(cursor, issueSort)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          const conditions: SQL[] = [
            eq(operationalIssues.workspaceId, auth.workspaceId),
          ];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(assets.branchId, auth.branchScope));
          }
          if (branchId) conditions.push(eq(assets.branchId, branchId));
          if (assetId) conditions.push(eq(operationalIssues.assetId, assetId));
          if (safetyCritical !== undefined) {
            conditions.push(
              eq(operationalIssues.safetyCritical, safetyCritical),
            );
          }
          if (status) conditions.push(eq(operationalIssues.status, status));
          if (decodedCursor) {
            conditions.push(
              afterKeyset(
                issueReportedAtColumn,
                issueSort.direction,
                operationalIssues.id,
                decodedCursor,
              ),
            );
          }

          const rows = await tx
            .select({
              id: operationalIssues.id,
              assetId: operationalIssues.assetId,
              assetCode: assets.assetCode,
              registrationNumber: assets.registrationNumber,
              branchId: assets.branchId,
              branchCode: branches.code,
              branchName: branches.name,
              description: operationalIssues.description,
              safetyCritical: operationalIssues.safetyCritical,
              category: operationalIssues.category,
              reportedAt: operationalIssues.reportedAt,
              reportedAtKey: microsecondKey(operationalIssues.reportedAt),
              status: operationalIssues.status,
              resolvedAt: operationalIssues.resolvedAt,
              resolutionNote: operationalIssues.resolutionNote,
              dismissedAt: operationalIssues.dismissedAt,
              dismissReason: operationalIssues.dismissReason,
              rowVersion: operationalIssues.rowVersion,
            })
            .from(operationalIssues)
            .innerJoin(
              assets,
              and(
                eq(assets.workspaceId, operationalIssues.workspaceId),
                eq(assets.id, operationalIssues.assetId),
              ),
            )
            .innerJoin(
              branches,
              and(
                eq(branches.workspaceId, assets.workspaceId),
                eq(branches.id, assets.branchId),
              ),
            )
            .where(and(...conditions))
            .orderBy(
              ...keysetOrderBy(
                issueReportedAtColumn,
                issueSort.direction,
                operationalIssues.id,
              ),
            )
            .limit(limit + 1);

          const pageRows = rows.slice(0, limit);
          const issueIds = pageRows.map((row) => row.id);
          const pageAssetIds = [...new Set(pageRows.map((row) => row.assetId))];

          // Sequential, same reason as the detail read: one connection per tx.
          const linkedWorkOrders =
            issueIds.length === 0
              ? []
              : await tx
                  .select({
                    id: workOrders.id,
                    issueId: workOrders.issueId,
                    status: workOrders.status,
                  })
                  .from(workOrders)
                  .where(
                    and(
                      eq(workOrders.workspaceId, auth.workspaceId),
                      inArray(workOrders.issueId, issueIds),
                    ),
                  )
                  .orderBy(asc(workOrders.id));

          const groundedAssets =
            pageAssetIds.length === 0
              ? []
              : await tx
                  .select({ assetId: assetAvailabilityIntervals.assetId })
                  .from(assetAvailabilityIntervals)
                  .where(
                    and(
                      eq(
                        assetAvailabilityIntervals.workspaceId,
                        auth.workspaceId,
                      ),
                      inArray(assetAvailabilityIntervals.assetId, pageAssetIds),
                      isNull(assetAvailabilityIntervals.closedAt),
                    ),
                  );

          return {
            rows,
            linkedWorkOrders,
            groundedAssetIds: groundedAssets.map((row) => row.assetId),
          };
        });

        if ("error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const hasNextPage = result.rows.length > limit;
        const pageRows = result.rows.slice(0, limit);

        const workOrdersByIssue = new Map<
          string,
          Array<{ id: string; status: string }>
        >();
        for (const workOrder of result.linkedWorkOrders) {
          if (workOrder.issueId === null) continue;
          const bucket = workOrdersByIssue.get(workOrder.issueId) ?? [];
          bucket.push({ id: workOrder.id, status: workOrder.status });
          workOrdersByIssue.set(workOrder.issueId, bucket);
        }
        const groundedAssetIds = new Set(result.groundedAssetIds);

        const items = pageRows.map((row) => ({
          id: row.id,
          asset: {
            id: row.assetId,
            assetCode: row.assetCode,
            registrationNumber: row.registrationNumber,
          },
          branch: {
            id: row.branchId,
            code: row.branchCode,
            name: row.branchName,
          },
          description: row.description,
          safetyCritical: row.safetyCritical,
          category: row.category,
          reportedAt: row.reportedAt.toISOString(),
          status: row.status,
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          resolutionNote: row.resolutionNote,
          dismissedAt: row.dismissedAt?.toISOString() ?? null,
          dismissReason: row.dismissReason,
          workOrders: workOrdersByIssue.get(row.id) ?? [],
          assetUnavailable: groundedAssetIds.has(row.assetId),
          rowVersion: row.rowVersion,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(issueSort, lastRow.reportedAtKey, lastRow.id);
        }

        return issueListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "issues list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  /**
   * One signalement by id — the deep link the vehicle's record panel opens.
   * The list row's fields plus its own trail, its photos and who closed it;
   * scope resolves through the asset like every maintenance read.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/issues/:issueId", module: "MAINTENANCE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const params = z.object({ issueId: z.uuid() }).safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { issueId } = params.data;

        const body = await read(async (tx) => {

          const conditions: SQL[] = [
            eq(operationalIssues.workspaceId, auth.workspaceId),
            eq(operationalIssues.id, issueId),
          ];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(assets.branchId, auth.branchScope));
          }
          const [row] = await tx
            .select({
              id: operationalIssues.id,
              assetId: operationalIssues.assetId,
              assetCode: assets.assetCode,
              registrationNumber: assets.registrationNumber,
              branchId: assets.branchId,
              branchCode: branches.code,
              branchName: branches.name,
              description: operationalIssues.description,
              safetyCritical: operationalIssues.safetyCritical,
              category: operationalIssues.category,
              reportedAt: operationalIssues.reportedAt,
              status: operationalIssues.status,
              resolvedAt: operationalIssues.resolvedAt,
              resolutionNote: operationalIssues.resolutionNote,
              dismissedAt: operationalIssues.dismissedAt,
              dismissReason: operationalIssues.dismissReason,
              rowVersion: operationalIssues.rowVersion,
              createdByCommandId: operationalIssues.createdByCommandId,
            })
            .from(operationalIssues)
            .innerJoin(
              assets,
              and(eq(assets.workspaceId, operationalIssues.workspaceId), eq(assets.id, operationalIssues.assetId)),
            )
            .innerJoin(
              branches,
              and(eq(branches.workspaceId, assets.workspaceId), eq(branches.id, assets.branchId)),
            )
            .where(and(...conditions))
            .limit(1);
          if (!row) throw notFound();

          const linkedWorkOrders = await tx
            .select({ id: workOrders.id, status: workOrders.status })
            .from(workOrders)
            .where(and(eq(workOrders.workspaceId, auth.workspaceId), eq(workOrders.issueId, row.id)))
            .orderBy(asc(workOrders.id));

          const [grounded] = await tx
            .select({ id: assetAvailabilityIntervals.id })
            .from(assetAvailabilityIntervals)
            .where(
              and(
                eq(assetAvailabilityIntervals.workspaceId, auth.workspaceId),
                eq(assetAvailabilityIntervals.assetId, row.assetId),
                isNull(assetAvailabilityIntervals.closedAt),
              ),
            )
            .limit(1);

          const eventRows = await tx
            .select({
              eventId: auditEvents.id,
              kind: auditEvents.eventType,
              occurredAt: auditEvents.occurredAt,
              note: noteSql(),
              noteCode: noteCodeSql(),
              scope: auditEvents.scope,
              principalId: auditEvents.tenantActorPrincipalId,
              displayName: principals.displayName,
            })
            .from(auditEvents)
            .leftJoin(principals, eq(principals.id, auditEvents.tenantActorPrincipalId))
            .where(
              and(
                eq(auditEvents.workspaceId, auth.workspaceId),
                eq(auditEvents.entityType, "operational_issue"),
                eq(auditEvents.entityId, row.id),
              ),
            )
            .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));

          const artifacts =
            (await commandArtifacts(tx, auth.workspaceId, [row.createdByCommandId])).get(
              row.createdByCommandId,
            ) ?? [];

          const closers =
            row.status === "OPEN"
              ? new Map<string, HistoryActor>()
              : await lastEventActors(tx, auth.workspaceId, "operational_issue", [row.id], ISSUE_CLOSURE_EVENTS);

          return {
            id: row.id,
            asset: { id: row.assetId, assetCode: row.assetCode, registrationNumber: row.registrationNumber },
            branch: { id: row.branchId, code: row.branchCode, name: row.branchName },
            description: row.description,
            safetyCritical: row.safetyCritical,
            category: row.category,
            reportedAt: row.reportedAt.toISOString(),
            status: row.status,
            resolvedAt: row.resolvedAt?.toISOString() ?? null,
            resolutionNote: row.resolutionNote,
            dismissedAt: row.dismissedAt?.toISOString() ?? null,
            dismissReason: row.dismissReason,
            workOrders: linkedWorkOrders,
            assetUnavailable: grounded !== undefined,
            rowVersion: row.rowVersion,
            chronologie: eventRows.map((event) => ({
              eventId: event.eventId,
              kind: event.kind,
              occurredAt: event.occurredAt.toISOString(),
              note: event.note,
              noteCode: event.noteCode,
              actor: toActor(event),
            })),
            artifactCount: artifacts.length,
            artifacts,
            closedBy: closers.get(row.id) ?? null,
          };
        });

        return issueDetail.parse(body);
      } catch (error) {
        return sendReadFailure(req, reply, error, "issue detail");
      }
    },
  );
}
