import {
  ENTRY_EXPORT_ROW_LIMIT,
  financialEntryExportQuery,
  ledgerEntryStatuses,
  moneyReadScope,
  type CancelledEntryRef,
  type FinancialEntryExportQuery,
} from "@routiq/contracts";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import writeExcelFile from "write-excel-file/node";
import type { RequireAuth } from "../../auth/plugin.js";
import type { Db } from "../../db/client.js";
import {
  activities,
  assets,
  auditEvents,
  branches,
  categories,
  commands,
  financialEntries,
  financialPostings,
  postingPeriods,
  principals,
  workspaces,
} from "../../db/schema.js";
import { currentBusinessDate } from "../business-date.js";
import { defineRead, ENTRIES_GATE, type ReadTx } from "../define-read.js";
import { cancelledBySql, cancelsSql, type CancellationRow } from "../entry-cancellation.js";
import { entryFilterConditions } from "../finance.js";
import { invalidRequest, ReadRefusal } from "../read-gate.js";
import { workspaceTimezone } from "../workspace-day.js";
import { buildWorkbook, type ExportEntry, type ExportHeader, type ExportTotals } from "./workbook.js";
import { EXPORT_WORDS, monthName, type ExportWords } from "./words.js";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The writer stores formulas without a computed value, so the Check sheet
 * would open blank where a spreadsheet does not recalculate on load.
 */
export function recalculateOnOpen(file: Uint8Array): Uint8Array {
  const files = unzipSync(file);
  const workbook = files["xl/workbook.xml"];
  if (workbook === undefined) throw new Error("xlsx without xl/workbook.xml");
  const xml = strFromU8(workbook);
  if (!xml.includes("<calcPr/>")) throw new Error("xlsx workbook without an empty calcPr");
  files["xl/workbook.xml"] = strToU8(xml.replace("<calcPr/>", '<calcPr fullCalcOnLoad="1"/>'));
  return zipSync(files);
}

/**
 * What a row counts for: the vehicle's share when the list is one vehicle's
 * (the Money tab's figure), else the entry's own signed amount, as the list.
 */
function amountSql(assetId: string | undefined): SQL<string> {
  if (assetId === undefined) return sql<string>`${financialEntries.amountMinor}::text`;
  return sql<string>`(
    select sum(${financialPostings.amountMinor})::text from ${financialPostings}
    where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
      and ${financialPostings.financialEntryId} = ${financialEntries.id}
      and ${financialPostings.assetId} = ${assetId}
  )`;
}

/** The vehicles an entry's lines name, by code; one vehicle's code on its own list. */
function vehicleSql(assetId: string | undefined): SQL<string | null> {
  return sql<string | null>`(
    select string_agg(distinct ${assets.assetCode}, ', ' order by ${assets.assetCode})
    from ${financialPostings}
    inner join ${assets}
      on ${assets.workspaceId} = ${financialPostings.workspaceId}
      and ${assets.id} = ${financialPostings.assetId}
    where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
      and ${financialPostings.financialEntryId} = ${financialEntries.id}
      ${assetId === undefined ? sql`` : sql`and ${financialPostings.assetId} = ${assetId}`}
  )`;
}

/** The trips an entry's lines name, by number, on the vehicle's lines when the list is one vehicle's. */
function tripSql(assetId: string | undefined): SQL<string | null> {
  return sql<string | null>`(
    select string_agg(distinct ${activities.activityNumber}, ', ' order by ${activities.activityNumber})
    from ${financialPostings}
    inner join ${activities}
      on ${activities.workspaceId} = ${financialPostings.workspaceId}
      and ${activities.id} = ${financialPostings.activityId}
    where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
      and ${financialPostings.financialEntryId} = ${financialEntries.id}
      ${assetId === undefined ? sql`` : sql`and ${financialPostings.assetId} = ${assetId}`}
  )`;
}

interface ApproverRow {
  displayName: string | null;
  scope: "WORKSPACE" | "PLATFORM";
}

/**
 * Who approved the entry: the actor of its last `financial_entry.approved`
 * event. NULL for an entry that posted on recording. The masking column, so a
 * vendor operator stays unnamed.
 */
function approverSql(): SQL<ApproverRow | null> {
  return sql<ApproverRow | null>`(
    select jsonb_build_object('displayName', approver.display_name, 'scope', ${auditEvents.scope})
    from ${auditEvents}
    left join ${principals} approver on approver.id = ${auditEvents.tenantActorPrincipalId}
    where ${auditEvents.workspaceId} = ${financialEntries.workspaceId}
      and ${auditEvents.entityType} = 'financial_entry'
      and ${auditEvents.entityId} = ${financialEntries.id}
      and ${auditEvents.eventType} = 'financial_entry.approved'
    order by ${auditEvents.occurredAt} desc
    limit 1
  )`;
}

function actorName(words: ExportWords, displayName: string | null, scope: "WORKSPACE" | "PLATFORM"): string | null {
  return scope === "PLATFORM" ? words.platformActor : displayName;
}

/** Letters, digits and dashes only: a name every file system and mail client keeps. */
function fileSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function describeFilters(words: ExportWords, query: FinancialEntryExportQuery, ownEntries: boolean): string {
  const parts: string[] = [];
  if (query.status === "LEDGER") parts.push(words.check.statusFilter(words.ledgerStatus));
  else if (query.status) parts.push(words.check.statusFilter(words.status[query.status]));
  if (query.direction) parts.push(words.check.directionFilter(words.direction[query.direction]));
  if (query.evidence === "MISSING") parts.push(words.check.missingReceipt);
  if (ownEntries) parts.push(words.check.ownEntries);
  return parts.length === 0 ? words.check.noFilter : parts.join(" · ");
}

function describePeriod(words: ExportWords, query: FinancialEntryExportQuery): string {
  const parts: string[] = [];
  if (query.periodCode) parts.push(words.check.postingPeriod(monthName(words, query.periodCode)));
  if (query.economicMonth) parts.push(words.check.economicMonth(monthName(words, query.economicMonth)));
  return parts.length === 0 ? words.check.allTime : parts.join(" · ");
}

interface LoadedExport {
  fileName: string;
  words: ExportWords;
  head: ExportHeader;
  entries: ExportEntry[];
  totals: ExportTotals;
}

async function loadExport(
  tx: ReadTx,
  auth: Parameters<typeof entryFilterConditions>[0],
  query: FinancialEntryExportQuery,
  rowLimit: number,
): Promise<LoadedExport> {
  const { lang = "fr", ...filters } = query;
  const words = EXPORT_WORDS[lang];
  const conditions = entryFilterConditions(auth, filters);
  const periodJoin = and(
    eq(postingPeriods.workspaceId, financialEntries.workspaceId),
    eq(postingPeriods.id, financialEntries.postingPeriodId),
  );

  const [counted] = await tx
    .select({ count: sql<number>`count(*)::integer` })
    .from(financialEntries)
    .leftJoin(postingPeriods, periodJoin)
    .where(and(...conditions));
  const count = counted?.count ?? 0;
  if (count > rowLimit) {
    throw new ReadRefusal(400, "EXPORT_TOO_LARGE", { limit: rowLimit, count });
  }

  const [workspace] = await tx
    .select({ name: workspaces.name, slug: workspaces.slug, currency: workspaces.defaultCurrency })
    .from(workspaces)
    .where(eq(workspaces.id, auth.workspaceId));
  const currency = workspace?.currency ?? "XAF";

  const amount = amountSql(query.assetId);
  const [totals] = await tx
    .select({
      expenseMinor: sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'EXPENSE' then (${amount})::bigint else 0 end), 0)::text`,
      revenueMinor: sql<string>`coalesce(sum(case when ${financialEntries.direction} = 'REVENUE' then (${amount})::bigint else 0 end), 0)::text`,
    })
    .from(financialEntries)
    .leftJoin(postingPeriods, periodJoin)
    .where(
      and(
        ...conditions,
        inArray(financialEntries.status, [...ledgerEntryStatuses]),
        eq(financialEntries.currency, currency),
      ),
    );

  const rows = await tx
    .select({
      id: financialEntries.id,
      entryNumber: financialEntries.entryNumber,
      direction: financialEntries.direction,
      status: financialEntries.status,
      amountMinor: amount,
      currency: financialEntries.currency,
      economicDate: financialEntries.economicDate,
      postingPeriodCode: postingPeriods.periodCode,
      categoryLabelFr: categories.labelFr,
      categoryLabelEn: categories.labelEn,
      description: financialEntries.description,
      vehicle: vehicleSql(query.assetId),
      trip: tripSql(query.assetId),
      reversesEntryId: financialEntries.reversesEntryId,
      reversalReasonCode: sql<string | null>`${commands.payload}->>'reasonCode'`,
      reversalReasonText: sql<string | null>`coalesce(${commands.payload}->>'reasonText', ${commands.payload}->>'reason')`,
      recorderDisplayName: principals.displayName,
      recorderScope: commands.scope,
      approver: approverSql(),
      cancelledBy: cancelledBySql(auth),
      cancels: cancelsSql(auth),
    })
    .from(financialEntries)
    .innerJoin(
      categories,
      and(eq(categories.workspaceId, financialEntries.workspaceId), eq(categories.id, financialEntries.categoryId)),
    )
    .leftJoin(postingPeriods, periodJoin)
    .innerJoin(
      commands,
      and(eq(commands.workspaceId, financialEntries.workspaceId), eq(commands.id, financialEntries.createdByCommandId)),
    )
    .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
    .where(and(...conditions))
    .orderBy(asc(financialEntries.economicDate), asc(financialEntries.entryNumber), asc(financialEntries.id));

  const entries: ExportEntry[] = rows.map((row) => ({
    id: row.id,
    entryNumber: row.entryNumber,
    direction: row.direction,
    status: row.status,
    amountMinor: BigInt(row.amountMinor),
    currency: row.currency,
    economicDate: row.economicDate,
    postingPeriodCode: row.postingPeriodCode,
    categoryLabel: lang === "en" ? row.categoryLabelEn : row.categoryLabelFr,
    description: row.description,
    vehicle: row.vehicle,
    trip: row.trip,
    reversesEntryId: row.reversesEntryId,
    reversalReasonCode: row.reversesEntryId === null ? null : row.reversalReasonCode,
    reversalReasonText: row.reversesEntryId === null ? null : row.reversalReasonText,
    recordedBy: actorName(words, row.recorderDisplayName, row.recorderScope),
    approvedBy: row.approver === null ? null : actorName(words, row.approver.displayName, row.approver.scope),
    cancelledBy: row.cancelledBy as CancellationRow | null,
    cancels: row.cancels as CancelledEntryRef | null,
  }));

  let assetCode: string | null = null;
  if (query.assetId) {
    const [asset] = await tx
      .select({ code: assets.assetCode })
      .from(assets)
      .where(and(eq(assets.workspaceId, auth.workspaceId), eq(assets.id, query.assetId)));
    assetCode = asset?.code ?? null;
  }
  let branchName: string | null = null;
  if (query.branchId) {
    const [branch] = await tx
      .select({ name: branches.name })
      .from(branches)
      .where(and(eq(branches.workspaceId, auth.workspaceId), eq(branches.id, query.branchId)));
    branchName = branch?.name ?? null;
  }

  const exportedOn = currentBusinessDate(new Date(), await workspaceTimezone(tx, auth.workspaceId));
  const company = workspace?.name ?? "";
  const listSlug = assetCode === null ? words.fileList : fileSlug(assetCode);
  const periodSlug = query.periodCode ?? query.economicMonth ?? words.fileAllTime;
  const fileName = [fileSlug(workspace?.slug ?? company), listSlug, fileSlug(periodSlug)]
    .filter((part) => part !== "")
    .join("-");

  return {
    fileName: `${fileName}.xlsx`,
    words,
    head: {
      company,
      list: assetCode === null ? words.check.allEntries : words.check.vehicle(assetCode),
      period: describePeriod(words, query),
      branch: branchName ?? words.check.allBranches,
      filters: describeFilters(words, query, moneyReadScope(auth.role) === "OWN_ENTRIES"),
      exportedOn,
      currency,
    },
    entries,
    totals: {
      expenseMinor: BigInt(totals?.expenseMinor ?? "0"),
      revenueMinor: BigInt(totals?.revenueMinor ?? "0"),
    },
  };
}

/**
 * `GET /v1/finance/entries/export` (#429): the entries list as an Excel file,
 * for the same filters and money read scope. Entries (one line per event),
 * Books (every signed row) and Check (ROUTIQ's totals beside formulas over
 * the two sheets). Reads only.
 */
export function registerEntriesExportReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
  rowLimit: number = ENTRY_EXPORT_ROW_LIMIT,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/finance/entries/export", ...ENTRIES_GATE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      const parsed = financialEntryExportQuery.safeParse(req.query);
      if (!parsed.success) throw invalidRequest();

      const loaded = await read((tx) => loadExport(tx, auth, parsed.data, rowLimit));
      const file = recalculateOnOpen(
        await writeExcelFile(buildWorkbook(loaded.words, loaded.head, loaded.entries, loaded.totals)).toBuffer(),
      );

      return reply
        .header("content-type", XLSX_TYPE)
        .header(
          "content-disposition",
          `attachment; filename="${loaded.fileName}"; filename*=UTF-8''${encodeURIComponent(loaded.fileName)}`,
        )
        .header("cache-control", "no-store")
        .send(Buffer.from(file.buffer, file.byteOffset, file.byteLength));
    },
  );
}
