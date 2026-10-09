import type {
  AssetAvailability,
  AssetCustodian,
  AssetLastReading,
  HistoryActor,
} from "@routiq/contracts";
import { and, desc, eq, isNull, max, sql, type SQL } from "drizzle-orm";
import type { AuthContext } from "../auth/types.js";
import {
  ISSUE_CLOSURE_EVENTS,
  otherOpenSafetyIssues,
  WORK_ORDER_COMPLETION_EVENTS,
} from "../commands/work-order-lookup.js";
import {
  assetAvailabilityIntervals,
  auditEvents,
  commands,
  memberships,
  meterReadings,
  operationalIssues,
  principals,
  workOrders,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { commandActors, lastEventActors } from "./actors.js";
import { readingBranchScope } from "./asset-readings.js";
import { serializeMinor } from "./serialize-minor.js";

/**
 * The three header facts the vehicle workspace opens on — who holds the
 * vehicle, whether it may be used, and what its meter last said. Each is a
 * separate small query, run sequentially: a transaction owns one connection.
 */

const UNKNOWN_ACTOR: HistoryActor = { principalId: null, displayName: null, scope: "WORKSPACE" };

export async function loadCustodian(
  tx: TenantTx,
  workspaceId: string,
  assetId: string,
  custodianMembershipId: string | null,
): Promise<AssetCustodian | null> {
  if (custodianMembershipId === null) return null;

  const [member] = await tx
    .select({
      membershipId: memberships.id,
      displayName: principals.displayName,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(principals, eq(principals.id, memberships.principalId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.id, custodianMembershipId)))
    .limit(1);
  if (!member) return null;

  // The assignment that last moved custody; the audit index covers the walk.
  const [assigned] = await tx
    .select({ occurredAt: auditEvents.occurredAt })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, workspaceId),
        eq(auditEvents.entityType, "asset"),
        eq(auditEvents.entityId, assetId),
        eq(auditEvents.eventType, "asset.assigned"),
        sql`'custodianMembershipId' = any(${auditEvents.changedFields})`,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(1);

  return {
    membershipId: member.membershipId,
    displayName: member.displayName,
    active: member.deactivatedAt === null,
    since: assigned?.occurredAt.toISOString() ?? null,
  };
}

/** Statuses in which a work order's completer is a live maker for the checks that follow. */
const COMPLETION_DECLARED = new Set(["COMPLETION_SUBMITTED", "COMPLETED"]);

/**
 * Availability from the intervals alone: an open interval is GROUNDED, anything
 * else AVAILABLE. The caller answers NOT_ASSESSED when MAINTENANCE is off.
 */
export async function loadAvailability(
  tx: TenantTx,
  workspaceId: string,
  assetId: string,
): Promise<AssetAvailability> {
  const [open] = await tx
    .select({
      id: assetAvailabilityIntervals.id,
      openedAt: assetAvailabilityIntervals.openedAt,
      openedByIssueId: assetAvailabilityIntervals.openedByIssueId,
      rowVersion: assetAvailabilityIntervals.rowVersion,
    })
    .from(assetAvailabilityIntervals)
    .where(
      and(
        eq(assetAvailabilityIntervals.workspaceId, workspaceId),
        eq(assetAvailabilityIntervals.assetId, assetId),
        isNull(assetAvailabilityIntervals.closedAt),
      ),
    )
    .limit(1);

  if (!open) {
    const [last] = await tx
      .select({ closedAt: max(assetAvailabilityIntervals.closedAt) })
      .from(assetAvailabilityIntervals)
      .where(
        and(
          eq(assetAvailabilityIntervals.workspaceId, workspaceId),
          eq(assetAvailabilityIntervals.assetId, assetId),
        ),
      );
    return { state: "AVAILABLE", since: last?.closedAt?.toISOString() ?? null };
  }

  const [issue] = await tx
    .select({
      id: operationalIssues.id,
      description: operationalIssues.description,
      safetyCritical: operationalIssues.safetyCritical,
      category: operationalIssues.category,
      status: operationalIssues.status,
      rowVersion: operationalIssues.rowVersion,
      reportedAt: operationalIssues.reportedAt,
      createdByCommandId: operationalIssues.createdByCommandId,
    })
    .from(operationalIssues)
    .where(
      and(
        eq(operationalIssues.workspaceId, workspaceId),
        eq(operationalIssues.id, open.openedByIssueId),
      ),
    )
    .limit(1);
  // The FK makes this unreachable; failing loudly beats inventing an issue.
  if (!issue) throw new Error(`grounding issue missing for interval ${open.id}`);

  const orders = await tx
    .select({
      id: workOrders.id,
      status: workOrders.status,
      rowVersion: workOrders.rowVersion,
      createdAt: commands.executedAt,
      createdByCommandId: workOrders.createdByCommandId,
    })
    .from(workOrders)
    .innerJoin(
      commands,
      and(eq(commands.workspaceId, workOrders.workspaceId), eq(commands.id, workOrders.createdByCommandId)),
    )
    .where(and(eq(workOrders.workspaceId, workspaceId), eq(workOrders.issueId, issue.id)))
    .orderBy(desc(commands.executedAt), desc(workOrders.id));

  const creators = await commandActors(tx, workspaceId, [
    issue.createdByCommandId,
    ...orders.map((order) => order.createdByCommandId),
  ]);
  const closers = await lastEventActors(tx, workspaceId, "operational_issue", [issue.id], ISSUE_CLOSURE_EVENTS);
  const completers = await lastEventActors(
    tx,
    workspaceId,
    "work_order",
    orders.map((order) => order.id),
    WORK_ORDER_COMPLETION_EVENTS,
  );
  const otherOpen = await otherOpenSafetyIssues(tx, workspaceId, assetId, issue.id);

  return {
    state: "GROUNDED",
    since: open.openedAt.toISOString(),
    intervalId: open.id,
    intervalRowVersion: open.rowVersion,
    issue: {
      id: issue.id,
      description: issue.description,
      safetyCritical: issue.safetyCritical,
      category: issue.category,
      status: issue.status,
      rowVersion: issue.rowVersion,
      reportedAt: issue.reportedAt.toISOString(),
      reportedBy: creators.get(issue.createdByCommandId) ?? UNKNOWN_ACTOR,
      closedBy: issue.status === "OPEN" ? null : (closers.get(issue.id) ?? null),
    },
    workOrders: orders.map((order) => ({
      id: order.id,
      status: order.status,
      rowVersion: order.rowVersion,
      createdAt: order.createdAt.toISOString(),
      createdBy: creators.get(order.createdByCommandId) ?? UNKNOWN_ACTOR,
      // A completion sent back returns the order to APPROVED; its old
      // completer is then nobody's maker until the work is declared again.
      completedBy: COMPLETION_DECLARED.has(order.status)
        ? (completers.get(order.id) ?? null)
        : null,
    })),
    otherOpenSafetyIssues: otherOpen,
  };
}

/**
 * The newest current reading, ODOMETER first: a vehicle with a kilometre count
 * is read by it, and HOURS is the fallback for plant that only runs standing.
 * The caller answers null when ACTIVITIES is off.
 */
export async function loadLastReading(
  tx: TenantTx,
  auth: AuthContext,
  assetId: string,
): Promise<AssetLastReading | null> {
  const conditions: SQL[] = [
    eq(meterReadings.workspaceId, auth.workspaceId),
    eq(meterReadings.assetId, assetId),
    isNull(meterReadings.supersededById),
  ];
  const scope = readingBranchScope(auth);
  if (scope) conditions.push(scope);

  const [reading] = await tx
    .select({
      id: meterReadings.id,
      readingType: meterReadings.readingType,
      value: meterReadings.value,
      observedAt: meterReadings.observedAt,
      source: meterReadings.source,
      activityId: meterReadings.activityId,
      createdByCommandId: meterReadings.createdByCommandId,
    })
    .from(meterReadings)
    .where(and(...conditions))
    .orderBy(
      sql`(${meterReadings.readingType} = 'ODOMETER') desc`,
      desc(meterReadings.observedAt),
      desc(meterReadings.id),
    )
    .limit(1);
  if (!reading) return null;

  const actors = await commandActors(tx, auth.workspaceId, [reading.createdByCommandId]);
  return {
    id: reading.id,
    readingType: reading.readingType,
    value: serializeMinor(reading.value),
    observedAt: reading.observedAt.toISOString(),
    source: reading.source,
    activityId: reading.activityId,
    recordedBy: actors.get(reading.createdByCommandId) ?? UNKNOWN_ACTOR,
  };
}
