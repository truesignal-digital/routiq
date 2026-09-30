import {
  financialEntryDetail,
  financialEntryFilters,
  ledgerEntryStatuses,
  financialEntryListResponse,
  listQuery,
  pendingApprovalsResponse,
  periodsResponse,
  type FinancialEntryListItem,
  type ListSort,
} from "@routiq/contracts";
import { entryEvidenceState } from "@routiq/domain";
import { and, asc, desc, eq, exists, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import {
  activities,
  assets,
  categories,
  commands,
  financialEntries,
  financialPostings,
  postingPeriods,
  principals,
  workOrders,
} from "../db/schema.js";
import { commandActors, toActor } from "./actors.js";
import {
  entryArtifactCountSql,
  entryEvidenceFiles,
  entryEvidenceMissingSql,
} from "./entry-evidence.js";
import {
  countPendingOutsideBranch,
  pendingApprovalConditions,
} from "./approvals-queue.js";
import {
  afterKeyset,
  bindBigint,
  bindDate,
  bindText,
  decodeColumnCursor,
  encodeKeysetCursor,
  isInt64Text,
  isIsoDate,
  keysetOrderBy,
  microsecondKey,
  timestampKeyset,
  type KeysetColumn,
  type KeysetValue,
} from "./cursor.js";
import { defineRead, LEDGER_GATE } from "./define-read.js";
import { sendReadFailure } from "./read-gate.js";
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
  economicDate: { column: financialEntries.economicDate, bind: bindDate, accepts: isIsoDate },
  // Null until an entry posts, so the null tail is part of this ordering.
  postedAt: timestampKeyset(financialEntries.postedAt, { nullable: true }),
  // The entry's own SIGNED total. Postings sum to it by invariant (§3.4), so
  // there is nothing to aggregate — and a reversal sorts below its original.
  amount: { column: financialEntries.amountMinor, bind: bindBigint, accepts: isInt64Text },
  entryNumber: { column: financialEntries.entryNumber, bind: bindText },
};

interface EntrySortRow {
  economicDate: string;
  /** `postedAt` as microsecond keyset text. */
  postedAtKey: string | null;
  amountMinor: bigint;
  entryNumber: string;
}

function entrySortValue(field: EntrySortField, row: EntrySortRow): KeysetValue {
  switch (field) {
    case "economicDate":
      return row.economicDate;
    case "postedAt":
      return row.postedAtKey;
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
  financialEntryFilters.shape,
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
  submittedAt: timestampKeyset(financialEntries.createdAt),
  amount: { column: financialEntries.amountMinor, bind: bindBigint, accepts: isInt64Text },
  entryNumber: { column: financialEntries.entryNumber, bind: bindText },
};

interface ApprovalSortRow {
  /** `submittedAt` as microsecond keyset text. */
  submittedAtKey: string;
  amountMinor: bigint;
  entryNumber: string;
}

function approvalSortValue(
  field: ApprovalSortField,
  row: ApprovalSortRow,
): KeysetValue {
  switch (field) {
    case "submittedAt":
      return row.submittedAtKey;
    case "amount":
      return row.amountMinor.toString();
    case "entryNumber":
      return row.entryNumber;
  }
}

/** The page size this read has always returned; kept as the default so a
 * paramless call is byte-for-byte what it was before pagination landed. */
const APPROVALS_PAGE_SIZE = 100;

// `branchId` is the client's own narrowing of a queue that otherwise spans the
// caller's whole scope — a decision queue defaults to every branch, because
// pending work hidden by an ambient filter is work nobody decides.
const approvalsQuerySchema = listQuery(
  { branchId: z.uuid().optional() },
  {
    sortFields: approvalSortFields,
    defaultLimit: APPROVALS_PAGE_SIZE,
    maxLimit: APPROVALS_PAGE_SIZE,
  },
);

/** The first day of `YYYY-MM` and of the month after it, as ISO dates. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    from: `${month}-01`,
    to: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

/**
 * The vehicle's lines of the outer entry, first by line number, carrying a
 * value in `column` — the attribution the Money tab links an entry to.
 */
function firstAssetLineSql(
  assetId: string,
  column: typeof financialPostings.activityId | typeof financialPostings.workOrderId,
): SQL {
  return sql`(
    select ${column} from ${financialPostings}
    where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
      and ${financialPostings.financialEntryId} = ${financialEntries.id}
      and ${financialPostings.assetId} = ${assetId}
      and ${column} is not null
    order by ${financialPostings.lineNo}
    limit 1
  )`;
}

/**
 * The entry's first line, by line number, carrying a value in `column`: what
 * the entry as a whole belongs to, on any vehicle (#87).
 */
function firstLineSql(
  column: typeof financialPostings.activityId | typeof financialPostings.workOrderId,
): SQL {
  return sql`(
    select ${column} from ${financialPostings}
    where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
      and ${financialPostings.financialEntryId} = ${financialEntries.id}
      and ${column} is not null
    order by ${financialPostings.lineNo}
    limit 1
  )`;
}

/**
 * The trip and the work order an entry belongs to, for every row of the list,
 * the approvals queue and the detail. The work order's vehicle comes along
 * because the order opens in that vehicle's workspace. Reads `financialEntries`
 * as the outer row.
 */
function entryLinkColumns() {
  return {
    linkActivityId: sql<string | null>`${firstLineSql(financialPostings.activityId)}`,
    linkActivityNumber: sql<string | null>`(
      select ${activities.activityNumber} from ${activities}
      where ${activities.workspaceId} = ${financialEntries.workspaceId}
        and ${activities.id} = ${firstLineSql(financialPostings.activityId)}
    )`,
    linkWorkOrderId: sql<string | null>`${firstLineSql(financialPostings.workOrderId)}`,
    linkWorkOrderAssetId: sql<string | null>`(
      select ${workOrders.assetId} from ${workOrders}
      where ${workOrders.workspaceId} = ${financialEntries.workspaceId}
        and ${workOrders.id} = ${firstLineSql(financialPostings.workOrderId)}
    )`,
  };
}

interface EntryLinkRow {
  linkActivityId: string | null;
  linkActivityNumber: string | null;
  linkWorkOrderId: string | null;
  linkWorkOrderAssetId: string | null;
}

function toEntryLinks(row: EntryLinkRow): FinancialEntryListItem["links"] {
  return {
    activityId: row.linkActivityId,
    activityNumber: row.linkActivityNumber,
    workOrderId: row.linkWorkOrderId,
    workOrderAssetId: row.linkWorkOrderAssetId,
  };
}

/**
 * The columns every entry row carries, list and approvals queue alike, so the
 * two can never drift apart. Reads `categories`, `postingPeriods`, `commands`
 * and `principals` as the queries below join them.
 */
function entryItemColumns(assetId: string | undefined) {
  return {
    id: financialEntries.id,
    entryNumber: financialEntries.entryNumber,
    direction: financialEntries.direction,
    status: financialEntries.status,
    categoryCode: categories.code,
    categoryLabelFr: categories.labelFr,
    categoryLabelEn: categories.labelEn,
    categoryLayer: categories.profitabilityLayer,
    evidencePolicy: categories.evidencePolicy,
    amountMinor: financialEntries.amountMinor,
    currency: financialEntries.currency,
    economicDate: financialEntries.economicDate,
    postingPeriodCode: postingPeriods.periodCode,
    isLatePosting: financialEntries.isLatePosting,
    branchId: financialEntries.branchId,
    counterpartyName: financialEntries.counterpartyName,
    paymentMethod: financialEntries.paymentMethod,
    paymentReference: financialEntries.paymentReference,
    estimateStatus: financialEntries.estimateStatus,
    postedAt: financialEntries.postedAt,
    rowVersion: financialEntries.rowVersion,
    reversesEntryId: financialEntries.reversesEntryId,
    artifactCount: entryArtifactCountSql(),
    // The generated masking column: NULL for PLATFORM receipts, so the
    // principals join finds nothing and the operator stays unnamed.
    recorderPrincipalId: commands.tenantActorPrincipalId,
    recorderDisplayName: principals.displayName,
    recorderScope: commands.scope,
    assetShareMinor:
      assetId === undefined
        ? sql<string | null>`null`
        : sql<string | null>`(
            select sum(${financialPostings.amountMinor})::text from ${financialPostings}
            where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
              and ${financialPostings.financialEntryId} = ${financialEntries.id}
              and ${financialPostings.assetId} = ${assetId}
          )`,
    assetActivityId:
      assetId === undefined
        ? sql<string | null>`null`
        : sql<string | null>`${firstAssetLineSql(assetId, financialPostings.activityId)}`,
    assetActivityNumber:
      assetId === undefined
        ? sql<string | null>`null`
        : sql<string | null>`(
            select ${activities.activityNumber} from ${activities}
            where ${activities.workspaceId} = ${financialEntries.workspaceId}
              and ${activities.id} = ${firstAssetLineSql(assetId, financialPostings.activityId)}
          )`,
    assetWorkOrderId:
      assetId === undefined
        ? sql<string | null>`null`
        : sql<string | null>`${firstAssetLineSql(assetId, financialPostings.workOrderId)}`,
    ...entryLinkColumns(),
  };
}

type EntryRow = typeof financialEntries.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;

/** A row of `entryItemColumns` as the joins above leave it. */
interface EntryItemRow extends EntryLinkRow {
  id: string;
  entryNumber: string;
  direction: EntryRow["direction"];
  status: EntryRow["status"];
  categoryCode: string;
  categoryLabelFr: string;
  categoryLabelEn: string;
  categoryLayer: CategoryRow["profitabilityLayer"];
  evidencePolicy: CategoryRow["evidencePolicy"];
  amountMinor: bigint;
  currency: string;
  economicDate: string;
  postingPeriodCode: string | null;
  isLatePosting: boolean;
  branchId: string;
  counterpartyName: string | null;
  paymentMethod: EntryRow["paymentMethod"];
  paymentReference: string | null;
  estimateStatus: EntryRow["estimateStatus"];
  postedAt: Date | null;
  rowVersion: number;
  reversesEntryId: string | null;
  artifactCount: number;
  recorderPrincipalId: string | null;
  recorderDisplayName: string | null;
  recorderScope: "WORKSPACE" | "PLATFORM";
  assetShareMinor: string | null;
  assetActivityId: string | null;
  assetActivityNumber: string | null;
  assetWorkOrderId: string | null;
}

function toEntryItem(row: EntryItemRow, withAsset: boolean): FinancialEntryListItem {
  return {
    id: row.id,
    entryNumber: row.entryNumber,
    direction: row.direction,
    status: row.status,
    category: {
      code: row.categoryCode,
      labelFr: row.categoryLabelFr,
      labelEn: row.categoryLabelEn,
      layer: row.categoryLayer,
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
    reversesEntryId: row.reversesEntryId,
    recordedBy: toActor({
      principalId: row.recorderPrincipalId,
      displayName: row.recorderDisplayName,
      scope: row.recorderScope,
    }),
    evidence: {
      state: entryEvidenceState({
        policy: row.evidencePolicy,
        artifactCount: row.artifactCount,
        paymentMethod: row.paymentMethod,
        paymentReference: row.paymentReference,
      }),
      artifactCount: row.artifactCount,
    },
    assetShareMinor:
      withAsset && row.assetShareMinor !== null ? serializeMinor(BigInt(row.assetShareMinor)) : null,
    assetLinks: withAsset
      ? {
          activityId: row.assetActivityId,
          activityNumber: row.assetActivityNumber,
          workOrderId: row.assetWorkOrderId,
        }
      : null,
    links: toEntryLinks(row),
  };
}

export function registerFinanceReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/finance/entries", ...LEDGER_GATE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = listQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const {
          status,
          direction,
          periodCode,
          economicMonth,
          evidence,
          assetId,
          branchId,
          cursor,
          limit,
        } = parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultEntrySort;
        const sortColumn = entrySortColumns[sort.field];

        const result = await read(async (tx) => {
          const decodedCursor = cursor
            ? decodeColumnCursor(cursor, sort, sortColumn)
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

          if (status === "LEDGER") {
            conditions.push(inArray(financialEntries.status, [...ledgerEntryStatuses]));
          } else if (status) {
            conditions.push(eq(financialEntries.status, status));
          }
          if (direction) {
            conditions.push(eq(financialEntries.direction, direction));
          }

          if (periodCode) {
            conditions.push(eq(postingPeriods.periodCode, periodCode));
          }
          if (economicMonth) {
            const { from, to } = monthBounds(economicMonth);
            conditions.push(gte(financialEntries.economicDate, from));
            conditions.push(lt(financialEntries.economicDate, to));
          }
          if (evidence === "MISSING") {
            conditions.push(entryEvidenceMissingSql());
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
              ...entryItemColumns(assetId),
              postedAtKey: microsecondKey(financialEntries.postedAt),
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
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, financialEntries.workspaceId),
                eq(commands.id, financialEntries.createdByCommandId),
              ),
            )
            .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
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
        const entries = rows
          .slice(0, limit)
          .map((row) => toEntryItem(row, assetId !== undefined));

        let nextCursor: string | null = null;
        if (hasNextPage && entries.length > 0) {
          // Encoded off the raw row: the mapped item has already lost the
          // bigint amount to its wire form and never carries the microsecond key.
          const lastRow = rows[entries.length - 1]!;
          nextCursor = encodeKeysetCursor(
            sort,
            entrySortValue(sort.field, lastRow),
            lastRow.id,
          );
        }

        return financialEntryListResponse.parse({ entries, nextCursor });
      } catch (error) {
        return sendReadFailure(req, reply, error, "finance entries list");
      }
    },
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/finance/entries/:entryId", ...LEDGER_GATE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedParams = z.object({ entryId: z.uuid() }).safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { entryId } = parsedParams.data;

        const result = await read(async (tx) => {
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
              createdByCommandId: financialEntries.createdByCommandId,
              ...entryLinkColumns(),
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
              layer: categories.profitabilityLayer,
              evidencePolicy: categories.evidencePolicy,
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

          const evidenceFiles = await entryEvidenceFiles(tx, auth.workspaceId, entry);
          const recorders = await commandActors(tx, auth.workspaceId, [entry.createdByCommandId]);

          return {
            entry,
            category,
            periodCode,
            postings: postingsRows,
            reversedByEntryId,
            evidenceFiles,
            recordedBy: recorders.get(entry.createdByCommandId),
          };
        });

        if (!result) {
          return reply.status(404).send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }

        const {
          entry,
          category,
          periodCode,
          postings,
          reversedByEntryId,
          evidenceFiles,
          recordedBy,
        } = result;

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
            layer: category?.layer ?? null,
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
          recordedBy: recordedBy ?? { principalId: null, displayName: null, scope: "WORKSPACE" },
          evidence: {
            state: entryEvidenceState({
              policy: category?.evidencePolicy ?? "RECEIPT_EXPECTED",
              artifactCount: evidenceFiles.length,
              paymentMethod: entry.paymentMethod,
              paymentReference: entry.paymentReference,
            }),
            artifactCount: evidenceFiles.length,
          },
          assetShareMinor: null,
          assetLinks: null,
          links: toEntryLinks(entry),
          evidenceFiles,
        };

        return financialEntryDetail.parse(response);
      } catch (error) {
        return sendReadFailure(req, reply, error, "finance entry detail");
      }
    },
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/finance/approvals", ...LEDGER_GATE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = approvalsQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { branchId, cursor, limit } = parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultApprovalSort;
        const sortColumn = approvalSortColumns[sort.field];

        const result = await read(async (tx) => {
          const decodedCursor = cursor
            ? decodeColumnCursor(cursor, sort, sortColumn)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          // Shared with the dashboard's pendingApprovals count — one definition
          // of the queue, so the two can never disagree on screen. The same
          // `branchId` the dashboard card carries narrows it here too.
          const conditions = pendingApprovalConditions(auth, branchId);

          // Counts the queue, not the page: the cursor never reaches this. Under
          // a branch filter it counts that branch, so `total` always describes
          // exactly the rows the caller asked for.
          const [countResult] = await tx
            .select({ count: sql<number>`count(*)::integer` })
            .from(financialEntries)
            .where(and(...conditions));
          const total = countResult?.count ?? 0;

          // What the filter is hiding — zero when there is no filter.
          const outsideBranchCount = await countPendingOutsideBranch(
            tx,
            auth,
            branchId,
          );

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
              ...entryItemColumns(undefined),
              submittedByPrincipalId: commands.initiatedByPrincipalId,
              submittedAt: financialEntries.createdAt,
              submittedAtKey: microsecondKey(financialEntries.createdAt),
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
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, financialEntries.workspaceId),
                eq(commands.id, financialEntries.createdByCommandId),
              ),
            )
            .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
            .where(and(...pageConditions))
            .orderBy(...keysetOrderBy(sortColumn, sort.direction, financialEntries.id))
            // One extra row is the has-next probe, never returned.
            .limit(limit + 1);

          return { rows, total, outsideBranchCount };
        });

        if (result && "error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const { rows, total, outsideBranchCount } = result || {
          rows: [],
          total: 0,
          outsideBranchCount: 0,
        };
        const hasNextPage = rows.length > limit;
        const pageRows = rows.slice(0, limit);

        const entries = pageRows.map((row) => ({
          ...toEntryItem(row, false),
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

        return pendingApprovalsResponse.parse({
          entries,
          nextCursor,
          total,
          outsideBranchCount,
        });
      } catch (error) {
        return sendReadFailure(req, reply, error, "finance approvals");
      }
    },
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/finance/periods", ...LEDGER_GATE, branchScope: "workspace" },
    async ({ req, reply, auth, read }) => {
      try {
        const result = await read(async (tx) => {
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
