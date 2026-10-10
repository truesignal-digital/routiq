import {
  assetAttentionResponse,
  ATTENTION_ITEM_LIMIT,
  canReadDocuments,
  canReadLedger,
  canReadWorkOrderCosts,
  DOCUMENT_EXPIRING_WINDOW_DAYS,
  type AssetAttentionItem,
  type AttentionSeverity,
  type ModuleCode,
} from "@routiq/contracts";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import {
  ISSUE_CLOSURE_EVENTS,
  WORK_ORDER_COMPLETION_EVENTS,
} from "../commands/work-order-lookup.js";
import type { Db } from "../db/client.js";
import {
  activities,
  activityAssetSegments,
  assetAvailabilityIntervals,
  assets,
  categories,
  commands,
  documents,
  financialEntries,
  financialPostings,
  operationalIssues,
  postingPeriods,
  principals,
  workOrders,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { commandActors, eventPrincipalIds, lastEvents, toActor } from "./actors.js";
import { requireScopedAsset } from "./asset-scope.js";
import { addDays, currentBusinessDate } from "./business-date.js";
import { entryEvidenceMissingSql } from "./entry-evidence.js";
import { invalidRequest, sendReadFailure } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";
import { costToCome, workOrderActualCostSql, workOrderCostToComeColumns } from "./work-order-cost.js";
import { dayStartSql, workspaceTimezone } from "./workspace-day.js";
import { directionDecidesEntries, entryApprovers } from "./approvals-queue.js";
import { ANY_ROLE, defineRead } from "./define-read.js";
import { directionNoteItems } from "./notes.js";
import { readableTripSql } from "./trip-scope.js";

const SEVERITY_RANK: Record<AttentionSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

/** Descriptions travel as params, bounded so a long report cannot flood the list. */
const clip = (text: string): string => (text.length > 140 ? `${text.slice(0, 139)}…` : text);

/** Whole days from `from` to `to`, both ISO dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

interface Grounding {
  intervalId: string;
  issueId: string;
}

/** When each signalement's grounding last ended, for those that grounded the vehicle. */
async function lastReleases(
  tx: TenantTx,
  workspaceId: string,
  issueIds: readonly string[],
): Promise<Map<string, Date>> {
  if (issueIds.length === 0) return new Map();
  const rows = await tx
    .select({
      issueId: assetAvailabilityIntervals.openedByIssueId,
      closedAt: sql<Date>`max(${assetAvailabilityIntervals.closedAt})`.mapWith(
        assetAvailabilityIntervals.closedAt,
      ),
    })
    .from(assetAvailabilityIntervals)
    .where(
      and(
        eq(assetAvailabilityIntervals.workspaceId, workspaceId),
        inArray(assetAvailabilityIntervals.openedByIssueId, [...issueIds]),
        isNotNull(assetAvailabilityIntervals.closedAt),
      ),
    )
    .groupBy(assetAvailabilityIntervals.openedByIssueId);
  return new Map(rows.map((row) => [row.issueId, row.closedAt]));
}

/**
 * `books`: FINANCE is on, so a cost still to come can be booked (#82). The
 * fleet To do (fleet-attention.ts) runs this per vehicle too, so a problem is
 * "unplanned" by one rule on the truck page and on every Overview.
 */
export async function maintenanceItems(
  tx: TenantTx,
  auth: AuthContext,
  assetId: string,
  books: boolean,
): Promise<{ items: AssetAttentionItem[]; grounding: Grounding | undefined }> {
  const ws = auth.workspaceId;
  const items: AssetAttentionItem[] = [];

  const [interval] = await tx
    .select({
      id: assetAvailabilityIntervals.id,
      rowVersion: assetAvailabilityIntervals.rowVersion,
      openedByIssueId: assetAvailabilityIntervals.openedByIssueId,
    })
    .from(assetAvailabilityIntervals)
    .where(
      and(
        eq(assetAvailabilityIntervals.workspaceId, ws),
        eq(assetAvailabilityIntervals.assetId, assetId),
        isNull(assetAvailabilityIntervals.closedAt),
      ),
    )
    .limit(1);
  const grounding = interval ? { intervalId: interval.id, issueId: interval.openedByIssueId } : undefined;

  const issueType = alias(categories, "issue_type");
  const issues = await tx
    .select({
      id: operationalIssues.id,
      number: operationalIssues.number,
      description: operationalIssues.description,
      safetyCritical: operationalIssues.safetyCritical,
      status: operationalIssues.status,
      reportedAt: operationalIssues.reportedAt,
      resolvedAt: operationalIssues.resolvedAt,
      dismissedAt: operationalIssues.dismissedAt,
      rowVersion: operationalIssues.rowVersion,
      categoryLabelFr: issueType.labelFr,
      categoryLabelEn: issueType.labelEn,
    })
    .from(operationalIssues)
    .leftJoin(
      issueType,
      and(
        eq(issueType.workspaceId, operationalIssues.workspaceId),
        eq(issueType.kind, "ISSUE_TYPE"),
        eq(issueType.code, operationalIssues.category),
      ),
    )
    .where(
      and(
        eq(operationalIssues.workspaceId, ws),
        eq(operationalIssues.assetId, assetId),
        // Open ones, plus the grounding one whatever its status: a closed
        // signalement can still be what keeps the truck off the road.
        grounding
          ? or(eq(operationalIssues.status, "OPEN"), eq(operationalIssues.id, grounding.issueId))!
          : eq(operationalIssues.status, "OPEN"),
      ),
    );

  const orders = await tx
    .select({
      id: workOrders.id,
      number: workOrders.number,
      issueId: workOrders.issueId,
      status: workOrders.status,
      description: workOrders.description,
      expectedCostMinor: workOrders.expectedCostMinor,
      actualCostMinor: workOrderActualCostSql(),
      costOutcome: workOrders.costOutcome,
      declaredCostMinor: workOrders.declaredCostMinor,
      ...workOrderCostToComeColumns(),
      currency: workOrders.currency,
      completionRejectReason: workOrders.completionRejectReason,
      completedAt: workOrders.completedAt,
      rowVersion: workOrders.rowVersion,
      createdAt: commands.executedAt,
      createdByCommandId: workOrders.createdByCommandId,
    })
    .from(workOrders)
    .innerJoin(
      commands,
      and(eq(commands.workspaceId, workOrders.workspaceId), eq(commands.id, workOrders.createdByCommandId)),
    )
    .where(
      and(
        eq(workOrders.workspaceId, ws),
        eq(workOrders.assetId, assetId),
        inArray(workOrders.status, ["SUBMITTED", "APPROVED", "COMPLETION_SUBMITTED", "COMPLETED"]),
      ),
    );

  const creators = await commandActors(
    tx,
    ws,
    orders.filter((order) => order.status === "SUBMITTED").map((order) => order.createdByCommandId),
  );
  const completions = await lastEvents(
    tx,
    ws,
    "work_order",
    orders.filter((order) => order.status === "COMPLETION_SUBMITTED").map((order) => order.id),
    WORK_ORDER_COMPLETION_EVENTS,
  );

  const inGrounding = (order: { issueId: string | null }) =>
    grounding !== undefined && order.issueId === grounding.issueId;
  const ACTIVE = new Set(["SUBMITTED", "APPROVED", "COMPLETION_SUBMITTED"]);

  const unplanned = issues
    .filter((row) => row.status === "OPEN")
    .map((issue) => {
      const own = orders.filter((order) => order.issueId === issue.id);
      const hasCompletedWorkOrder = own.some((order) => order.status === "COMPLETED");
      return {
        issue,
        planned: own.some((order) => ACTIVE.has(order.status)),
        hasCompletedWorkOrder,
        // Released on its completed work order with the signalement left OPEN.
        stillOpenAfterRelease:
          grounding === undefined && issue.safetyCritical && hasCompletedWorkOrder,
      };
    })
    .filter((entry) => !entry.planned);
  const releasedAt = await lastReleases(
    tx,
    ws,
    unplanned.filter((entry) => entry.stillOpenAfterRelease).map((entry) => entry.issue.id),
  );

  for (const { issue, hasCompletedWorkOrder, stillOpenAfterRelease } of unplanned) {
    const since = stillOpenAfterRelease
      ? (releasedAt.get(issue.id) ?? issue.reportedAt)
      : issue.reportedAt;
    items.push({
      code: stillOpenAfterRelease ? "ISSUE_OPEN_WHILE_AVAILABLE" : "ISSUE_UNPLANNED",
      severity: stillOpenAfterRelease ? "INFO" : issue.safetyCritical ? "CRITICAL" : "WARNING",
      subject: { entityType: "operational_issue", id: issue.id, number: null, rowVersion: issue.rowVersion },
      since: since.toISOString(),
      partOfGrounding: grounding?.issueId === issue.id,
      makerPrincipalIds: [],
      params: {
        recordNumber: issue.number,
        description: clip(issue.description),
        safetyCritical: issue.safetyCritical,
        hasCompletedWorkOrder,
        ...(issue.categoryLabelFr === null ? {} : { categoryLabelFr: issue.categoryLabelFr }),
        ...(issue.categoryLabelEn === null ? {} : { categoryLabelEn: issue.categoryLabelEn }),
      },
    });
  }

  // Work-order money is Finance's (#328), and hidden from a driver (#390).
  const costsVisible = books && canReadWorkOrderCosts(auth.role);
  for (const order of orders) {
    const subject = {
      entityType: "work_order" as const,
      id: order.id,
      number: null,
      rowVersion: order.rowVersion,
    };
    // Absent for a caller who may not read work-order costs (#390): the
    // sentence without an amount, never a zero.
    const costs = !costsVisible
      ? {}
      : {
          ...(order.expectedCostMinor === null
            ? {}
            : { expectedCostMinor: serializeMinor(order.expectedCostMinor) }),
          ...(order.actualCostMinor === null
            ? {}
            : { actualCostMinor: serializeMinor(BigInt(order.actualCostMinor)) }),
          currency: order.currency,
        };
    if (order.status === "SUBMITTED") {
      const maker = creators.get(order.createdByCommandId)?.principalId;
      items.push({
        code: "WORK_ORDER_AWAITING_AUTHORIZATION",
        severity: "WARNING",
        subject,
        since: order.createdAt.toISOString(),
        partOfGrounding: inGrounding(order),
        makerPrincipalIds: maker ? [maker] : [],
        params: { recordNumber: order.number, description: clip(order.description), ...costs },
      });
    } else if (order.status === "APPROVED") {
      items.push({
        code: "WORK_ORDER_IN_PROGRESS",
        severity: order.completionRejectReason === null ? "INFO" : "WARNING",
        subject,
        since: order.createdAt.toISOString(),
        partOfGrounding: inGrounding(order),
        makerPrincipalIds: [],
        params: {
          recordNumber: order.number,
          description: clip(order.description),
          ...costs,
          ...(order.completionRejectReason === null
            ? {}
            : { completionRejectReason: order.completionRejectReason }),
        },
      });
    } else if (order.status === "COMPLETION_SUBMITTED") {
      const completion = completions.get(order.id);
      const maker = completion?.actor.principalId;
      items.push({
        code: "WORK_ORDER_AWAITING_SIGN_OFF",
        severity: "WARNING",
        subject,
        since: (completion?.occurredAt ?? order.createdAt).toISOString(),
        partOfGrounding: inGrounding(order),
        makerPrincipalIds: maker ? [maker] : [],
        params: { recordNumber: order.number, description: clip(order.description), ...costs },
      });
    } else if (order.status === "COMPLETED" && costsVisible) {
      const toCome = costToCome(order);
      // A line awaiting review is already on the list as ENTRY_AWAITING_REVIEW.
      if (toCome !== null && !toCome.awaitingApproval) {
        items.push({
          code: "WORK_ORDER_COST_TO_COME",
          severity: "WARNING",
          subject,
          since: (order.completedAt ?? order.createdAt).toISOString(),
          // The grounding sentence speaks of the release, never of the invoice.
          partOfGrounding: false,
          makerPrincipalIds: [],
          params: {
            recordNumber: order.number,
            description: clip(order.description),
            currency: order.currency,
            ...(toCome.reason === "DECLARED_NOT_RECORDED"
              ? {
                  declaredCostMinor: toCome.declaredCostMinor,
                  recordedCostMinor: toCome.recordedCostMinor,
                }
              : {}),
          },
        });
      }
    }
  }

  const groundingIssue = grounding ? issues.find((issue) => issue.id === grounding.issueId) : undefined;
  if (interval && groundingIssue) {
    const completed = orders.filter(
      (order) => order.issueId === groundingIssue.id && order.status === "COMPLETED",
    );
    const issueClosed = groundingIssue.status !== "OPEN";
    // The release refuses while any other safety-critical signalement is
    // OPEN (SAFETY_ISSUE_OPEN); those show as their own items meanwhile.
    const blocked = issues.some(
      (issue) => issue.status === "OPEN" && issue.safetyCritical && issue.id !== groundingIssue.id,
    );
    if ((completed.length > 0 || issueClosed) && !blocked) {
      // The release refuses whoever vouched the fault is gone after a
      // safety-critical report: every completer, or on the override path the
      // closer of the signalement (release-asset-to-service.ts).
      const vouchers = !groundingIssue.safetyCritical
        ? new Set<string>()
        : completed.length > 0
          ? await eventPrincipalIds(
              tx,
              ws,
              "work_order",
              completed.map((order) => order.id),
              WORK_ORDER_COMPLETION_EVENTS,
            )
          : await eventPrincipalIds(tx, ws, "operational_issue", [groundingIssue.id], ISSUE_CLOSURE_EVENTS);
      const readySince =
        completed.length > 0
          ? completed
              .map((order) => order.completedAt ?? order.createdAt)
              .reduce((latest, at) => (at > latest ? at : latest))
          : (groundingIssue.resolvedAt ?? groundingIssue.dismissedAt ?? groundingIssue.reportedAt);
      items.push({
        code: "ASSET_AWAITING_RELEASE",
        severity: "CRITICAL",
        subject: {
          entityType: "asset_availability_interval",
          id: interval.id,
          number: null,
          rowVersion: interval.rowVersion,
        },
        since: readySince.toISOString(),
        partOfGrounding: true,
        makerPrincipalIds: [...vouchers].sort(),
        params: {
          description: clip(groundingIssue.description),
          safetyCritical: groundingIssue.safetyCritical,
          overrideRequired: completed.length === 0,
          hasCompletedWorkOrder: completed.length > 0,
        },
      });
    }
  }

  return { items, grounding };
}

export interface VehicleAttention<T> {
  asset: { id: string; assetCode: string; branchId: string };
  item: T;
}

/**
 * Current documents of the vehicles `vehicles` selects (a condition on
 * `assets`) that expire within `horizonDays`, or already have. The truck page
 * asks for one vehicle; the fleet To do and Coming up for the caller's branches.
 */
export async function documentAttentionRows(
  tx: TenantTx,
  workspaceId: string,
  vehicles: SQL,
  businessDate: string,
  timezone: string,
  horizonDays: number = DOCUMENT_EXPIRING_WINDOW_DAYS,
): Promise<Array<VehicleAttention<AssetAttentionItem>>> {
  const superseding = alias(documents, "superseding");
  // The workspace's midnight, so the edge sits where the business date turns.
  const dayStart = (date: SQL) => dayStartSql(date, timezone).mapWith(documents.createdAt);
  const rows = await tx
    .select({
      id: documents.id,
      documentNumber: documents.documentNumber,
      documentTypeCode: documents.documentTypeCode,
      expiresAt: documents.expiresAt,
      expiredSince: dayStart(sql`${documents.expiresAt}`),
      expiringSince: dayStart(
        sql`${documents.expiresAt} - ${DOCUMENT_EXPIRING_WINDOW_DAYS}::int`,
      ),
      labelFr: categories.labelFr,
      labelEn: categories.labelEn,
      assetId: assets.id,
      assetCode: assets.assetCode,
      branchId: assets.branchId,
    })
    .from(documents)
    .innerJoin(assets, and(eq(assets.workspaceId, documents.workspaceId), eq(assets.id, documents.assetId)))
    .leftJoin(
      superseding,
      and(eq(superseding.workspaceId, documents.workspaceId), eq(superseding.supersedesDocumentId, documents.id)),
    )
    .leftJoin(
      categories,
      and(
        eq(categories.workspaceId, documents.workspaceId),
        eq(categories.kind, "DOCUMENT_TYPE"),
        eq(categories.code, documents.documentTypeCode),
      ),
    )
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        vehicles,
        // Current documents only: a renewal supersedes the old row.
        isNull(superseding.id),
        isNotNull(documents.expiresAt),
        lte(documents.expiresAt, addDays(businessDate, horizonDays)),
      ),
    );

  return rows.map((row) => {
    const expiresAt = row.expiresAt!;
    const expired = expiresAt < businessDate;
    return {
      asset: { id: row.assetId, assetCode: row.assetCode, branchId: row.branchId },
      item: {
        code: expired ? "DOCUMENT_EXPIRED" : "DOCUMENT_EXPIRING",
        severity: expired ? "CRITICAL" : "WARNING",
        subject: { entityType: "document", id: row.id, number: row.documentNumber, rowVersion: null },
        since: (expired ? row.expiredSince : row.expiringSince).toISOString(),
        partOfGrounding: false,
        makerPrincipalIds: [],
        params: {
          documentTypeLabelFr: row.labelFr ?? row.documentTypeCode,
          documentTypeLabelEn: row.labelEn ?? row.documentTypeCode,
          expiresAt,
          daysLeft: daysBetween(businessDate, expiresAt),
        },
      } satisfies AssetAttentionItem,
    };
  });
}

/**
 * Still owes its paperwork: waiting for a decision, or posted while its month
 * is open, with no receipt where one is expected (ENTRY_EVIDENCE_MISSING).
 * Over the outer `financial_entries` row.
 */
export function evidenceStillDueSql(): SQL {
  return and(
    or(
      eq(financialEntries.status, "SUBMITTED"),
      and(
        eq(financialEntries.status, "POSTED"),
        // Every column written with its table: drizzle leaves the outer one
        // bare when the select reads financial_entries alone (#483).
        sql`exists (
          select 1 from ${postingPeriods} open_period
          where open_period.workspace_id = ${sql.identifier("financial_entries")}.workspace_id
            and open_period.id = ${sql.identifier("financial_entries")}.posting_period_id
            and open_period.status = 'OPEN'
        )`,
      ),
    ),
    entryEvidenceMissingSql(),
  )!;
}

async function entryItems(
  tx: TenantTx,
  auth: AuthContext,
  assetId: string,
): Promise<AssetAttentionItem[]> {
  const onVehicle = sql`exists (
    select 1 from ${financialPostings}
    where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
      and ${financialPostings.financialEntryId} = ${financialEntries.id}
      and ${financialPostings.assetId} = ${assetId}
  )`;
  const conditions: SQL[] = [
    eq(financialEntries.workspaceId, auth.workspaceId),
    onVehicle,
    // Posted paperwork can still be completed while its month is open.
    or(eq(financialEntries.status, "SUBMITTED"), evidenceStillDueSql())!,
  ];
  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(financialEntries.branchId, auth.branchScope));
  }

  const rows = await tx
    .select({
      id: financialEntries.id,
      entryNumber: financialEntries.entryNumber,
      status: financialEntries.status,
      branchId: financialEntries.branchId,
      amountMinor: financialEntries.amountMinor,
      rowVersion: financialEntries.rowVersion,
      createdAt: financialEntries.createdAt,
      createdByCommandId: financialEntries.createdByCommandId,
      currency: financialEntries.currency,
      categoryLabelFr: categories.labelFr,
      categoryLabelEn: categories.labelEn,
      recorderPrincipalId: commands.tenantActorPrincipalId,
      recorderDisplayName: principals.displayName,
      recorderScope: commands.scope,
      evidenceMissing: sql<boolean>`${entryEvidenceMissingSql()}`,
      // This vehicle's share, signed: what the entry means for this truck.
      shareMinor: sql<string>`(
        select coalesce(sum(${financialPostings.amountMinor}), 0)::text from ${financialPostings}
        where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
          and ${financialPostings.financialEntryId} = ${financialEntries.id}
          and ${financialPostings.assetId} = ${assetId}
      )`,
    })
    .from(financialEntries)
    .innerJoin(
      categories,
      and(eq(categories.workspaceId, financialEntries.workspaceId), eq(categories.id, financialEntries.categoryId)),
    )
    .innerJoin(
      commands,
      and(eq(commands.workspaceId, financialEntries.workspaceId), eq(commands.id, financialEntries.createdByCommandId)),
    )
    .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
    .where(and(...conditions));

  const directionDecides = await directionDecidesEntries(tx, auth, rows);
  const approvers = await entryApprovers(tx, auth.workspaceId, rows);
  const items: AssetAttentionItem[] = [];
  for (const [index, row] of rows.entries()) {
    const recordedBy = toActor({
      principalId: row.recorderPrincipalId,
      displayName: row.recorderDisplayName,
      scope: row.recorderScope,
    });
    const subject = {
      entityType: "financial_entry" as const,
      id: row.id,
      number: row.entryNumber,
      rowVersion: row.rowVersion,
    };
    const params = {
      amountMinor: serializeMinor(BigInt(row.shareMinor)),
      currency: row.currency,
      recordedBy,
      categoryLabelFr: row.categoryLabelFr,
      categoryLabelEn: row.categoryLabelEn,
    };
    if (row.status === "SUBMITTED") {
      items.push({
        code: "ENTRY_AWAITING_REVIEW",
        severity: "INFO",
        subject,
        since: row.createdAt.toISOString(),
        partOfGrounding: false,
        makerPrincipalIds: row.recorderPrincipalId ? [row.recorderPrincipalId] : [],
        params: {
          ...params,
          directionDecides: directionDecides[index] ?? false,
          ...(approvers[index] ? { approver: approvers[index] } : {}),
        },
      });
    }
    if (row.evidenceMissing) {
      items.push({
        code: "ENTRY_EVIDENCE_MISSING",
        severity: "WARNING",
        subject,
        since: row.createdAt.toISOString(),
        partOfGrounding: false,
        makerPrincipalIds: [],
        params,
      });
    }
  }
  return items;
}

/**
 * The vehicle on two unfinished trips at once (#577): two OPEN trips holding
 * it on open segments are the fact, whatever their windows say. One item per
 * trip the caller may read, naming the others the caller may read, since the
 * moment the vehicle came to be on both. A start is accepted with
 * VEHICLE_DOUBLE_BOOKED; this is what stays until someone closes the stale trip.
 */
async function tripItems(tx: TenantTx, auth: AuthContext, assetId: string): Promise<AssetAttentionItem[]> {
  const holding = await tx
    .selectDistinct({
      id: activities.id,
      activityNumber: activities.activityNumber,
      rowVersion: activities.rowVersion,
      startedAt: activities.startedAt,
      readable: sql<boolean>`${readableTripSql(auth)}`,
    })
    .from(activities)
    .innerJoin(
      activityAssetSegments,
      and(
        eq(activityAssetSegments.workspaceId, activities.workspaceId),
        eq(activityAssetSegments.activityId, activities.id),
      ),
    )
    .where(
      and(
        eq(activities.workspaceId, auth.workspaceId),
        eq(activities.status, "OPEN"),
        eq(activityAssetSegments.assetId, assetId),
        isNull(activityAssetSegments.endedAt),
      ),
    )
    .orderBy(activities.activityNumber, activities.id);
  if (holding.length < 2) return [];

  const items: AssetAttentionItem[] = [];
  for (const trip of holding) {
    if (!trip.readable) continue;
    const others = holding.filter((other) => other.id !== trip.id);
    const since = [trip, ...others]
      .map((each) => each.startedAt)
      .filter((at): at is Date => at !== null)
      .reduce((latest, at) => (at > latest ? at : latest), new Date(0));
    items.push({
      code: "VEHICLE_DOUBLE_BOOKED",
      severity: "WARNING",
      subject: { entityType: "activity", id: trip.id, number: trip.activityNumber, rowVersion: trip.rowVersion },
      since: since.toISOString(),
      partOfGrounding: false,
      makerPrincipalIds: [],
      params: { tripNumbers: others.filter((other) => other.readable).map((other) => other.activityNumber) },
    });
  }
  return items;
}

async function loadAttention(tx: TenantTx, auth: AuthContext, assetId: string, modules: ReadonlySet<ModuleCode>) {
  const timezone = await workspaceTimezone(tx, auth.workspaceId);
  const businessDate = currentBusinessDate(new Date(), timezone);

  // Notes are CORE: whoever sees the vehicle sees Direction's notes on it (#98).
  const items: AssetAttentionItem[] = await directionNoteItems(tx, auth, assetId);
  if (modules.has("MAINTENANCE")) {
    items.push(...(await maintenanceItems(tx, auth, assetId, modules.has("FINANCE"))).items);
  }
  if (modules.has("DOCUMENTS") && canReadDocuments(auth.role)) {
    const rows = await documentAttentionRows(tx, auth.workspaceId, eq(assets.id, assetId), businessDate, timezone);
    items.push(...rows.map((row) => row.item));
  }
  if (modules.has("ACTIVITIES")) {
    items.push(...(await tripItems(tx, auth, assetId)));
  }
  // Ledger facts only for the roles that read the books (DECISIONS 1).
  if (modules.has("FINANCE") && canReadLedger(auth.role)) {
    items.push(...(await entryItems(tx, auth, assetId)));
  }

  items.sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      left.since.localeCompare(right.since) ||
      left.subject.id.localeCompare(right.subject.id) ||
      left.code.localeCompare(right.code),
  );
  return { assetId, businessDate, items: items.slice(0, ATTENTION_ITEM_LIMIT) };
}

export function registerAssetAttentionReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * What needs someone on this vehicle, computed where the business date,
   * branch scope and module gates live. Sources whose module is off are simply
   * absent; the read itself belongs to ASSETS.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/assets/:assetId/attention", module: "ASSETS", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, modules, read }) => {
      try {
        const params = z.object({ assetId: z.uuid() }).safeParse(req.params);
        if (!params.success) throw invalidRequest();
        const { assetId } = params.data;

        const body = await read(async (tx) => {
          await requireScopedAsset(tx, auth, assetId);
          return loadAttention(tx, auth, assetId, modules);
        });
        return assetAttentionResponse.parse(body);
      } catch (error) {
        return sendReadFailure(req, reply, error, "asset attention");
      }
    },
  );
}
