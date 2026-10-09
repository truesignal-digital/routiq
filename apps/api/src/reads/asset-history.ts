import {
  canReadDocuments,
  canReadEntries,
  canReadLedger,
  HISTORY_ENTITY_MODULE,
  vehicleHistoryQuery,
  vehicleHistoryResponse,
  type CommandOrigin,
  type HistoryEntityType,
  type HistoryFieldChange,
  type ListSort,
  type ModuleCode,
  type Role,
  type VehicleHistoryItem,
  type VehicleHistoryKind,
} from "@routiq/contracts";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import {
  activities,
  activityAssetSegments,
  assetAvailabilityIntervals,
  auditEvents,
  branches,
  categories,
  commandSourceArtifacts,
  commands,
  documents,
  financialEntries,
  financialPostings,
  memberships,
  meterReadings,
  movementLegs,
  notes,
  operationalIssues,
  places,
  principals,
  workOrders,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { toActor } from "./actors.js";
import { diffStates } from "./history.js";
import { readingBranchScope } from "./asset-readings.js";
import { requireScopedAsset } from "./asset-scope.js";
import { decodeTimestampCursor, encodeKeysetCursor, microsecondKey } from "./cursor.js";
import { noteCodeSql, noteSql } from "./history.js";
import { invalidRequest, sendReadFailure } from "./read-gate.js";
import { serializeMinor } from "./serialize-minor.js";
import { ANY_ROLE, defineRead } from "./define-read.js";
import { readableEntrySql } from "./money-scope.js";

/**
 * The vehicle timeline as ONE statement (PLAN §1.5): a CTE lists every record
 * that belongs to the vehicle — the "subject set", one UNION ALL branch per
 * source — and joins the audit trail once, newest first, with the keyset and
 * the limit applied in the database.
 *
 * Why one statement rather than a query per source merged in code: a page is
 * one round trip instead of ~10 sequential ones (a transaction owns one
 * connection, and this is read on 2G); keyset pagination stays exact with the
 * limit in SQL instead of over-fetching limit+1 from every source and merging;
 * branch scope and module gates are each a predicate on a branch, decided
 * once; and every subject walks `audit_events_ws_entity_occurred_idx`. The
 * price is a longer statement, kept readable by building it from the typed
 * `SOURCES` list below and tested source by source.
 */

const historySort: ListSort<"occurredAt"> = { field: "occurredAt", direction: "desc" };

/**
 * The keyset position is the event time to the MICROsecond, as text: the
 * events of one command share a transaction timestamp, and a millisecond
 * cursor would skip the rest of a command split across two pages.
 */
const occurredAtKeySql = microsecondKey(auditEvents.occurredAt);

interface SourceContext {
  workspaceId: string;
  assetId: string;
  auth: AuthContext;
}

interface HistorySource {
  entityType: HistoryEntityType;
  /** Null only for the vehicle itself, whose kind is read from each event. */
  kind: VehicleHistoryKind | null;
  /** Kinds this source can produce, for skipping it under a kind filter. */
  kinds: readonly VehicleHistoryKind[];
  /**
   * Roles that read this source at all, when not every role does: entries for
   * the roles that read them (row by row by their money scope, #264),
   * documents for everyone but the counter.
   */
  visibleTo?: (role: Role) => boolean;
  /** One CTE branch: (entity_type, entity_id, kind, ref_number, amount_minor, currency). */
  subjects(context: SourceContext): SQL;
}

const scopeClause = (
  auth: AuthContext,
  column: typeof activities.branchId,
): SQL =>
  auth.branchScope === "ALL" ? sql`` : sql`and ${inArray(column, auth.branchScope)}`;

/** The outer activity carries this vehicle on one of its segments. */
const activityOnVehicle = (assetId: string): SQL => sql`exists (
  select 1 from ${activityAssetSegments}
  where ${activityAssetSegments.workspaceId} = ${activities.workspaceId}
    and ${activityAssetSegments.activityId} = ${activities.id}
    and ${activityAssetSegments.assetId} = ${assetId}
)`;

/**
 * Every source, with the branch rule the record history applies to its entity
 * type (#58): an activity and its legs and segments by the activity's branch, a
 * financial entry by its own, a reading taken during a job by the job's, and
 * everything the vehicle owns outright by the vehicle's — already checked.
 */
const SOURCES: readonly HistorySource[] = [
  {
    entityType: "asset",
    kind: null,
    kinds: ["ASSIGNMENTS", "LIFECYCLE"],
    subjects: ({ assetId }) =>
      sql`select 'asset'::text, ${assetId}::uuid, null::text, null::text, null::bigint, null::text`,
  },
  {
    entityType: "activity",
    kind: "TRIPS",
    kinds: ["TRIPS"],
    subjects: ({ workspaceId, assetId, auth }) => sql`
      select 'activity'::text, ${activities.id}, 'TRIPS'::text, ${activities.activityNumber}, null::bigint, null::text
      from ${activities}
      where ${activities.workspaceId} = ${workspaceId}
        and ${activityOnVehicle(assetId)}
        ${scopeClause(auth, activities.branchId)}`,
  },
  {
    entityType: "movement_leg",
    kind: "TRIPS",
    kinds: ["TRIPS"],
    subjects: ({ workspaceId, assetId, auth }) => sql`
      select 'movement_leg'::text, ${movementLegs.id}, 'TRIPS'::text, ${activities.activityNumber}, null::bigint, null::text
      from ${movementLegs}
      inner join ${activities}
        on ${activities.workspaceId} = ${movementLegs.workspaceId}
        and ${activities.id} = ${movementLegs.activityId}
      where ${movementLegs.workspaceId} = ${workspaceId}
        and ${activityOnVehicle(assetId)}
        ${scopeClause(auth, activities.branchId)}`,
  },
  {
    entityType: "activity_asset_segment",
    kind: "TRIPS",
    kinds: ["TRIPS"],
    subjects: ({ workspaceId, assetId, auth }) => sql`
      select 'activity_asset_segment'::text, ${activityAssetSegments.id}, 'TRIPS'::text, ${activities.activityNumber}, null::bigint, null::text
      from ${activityAssetSegments}
      inner join ${activities}
        on ${activities.workspaceId} = ${activityAssetSegments.workspaceId}
        and ${activities.id} = ${activityAssetSegments.activityId}
      where ${activityAssetSegments.workspaceId} = ${workspaceId}
        and ${activityAssetSegments.assetId} = ${assetId}
        ${scopeClause(auth, activities.branchId)}`,
  },
  {
    entityType: "meter_reading",
    kind: "READINGS",
    kinds: ["READINGS"],
    subjects: ({ workspaceId, assetId, auth }) => {
      const scope = readingBranchScope(auth);
      return sql`
        select 'meter_reading'::text, ${meterReadings.id}, 'READINGS'::text, null::text, null::bigint, null::text
        from ${meterReadings}
        where ${meterReadings.workspaceId} = ${workspaceId}
          and ${meterReadings.assetId} = ${assetId}
          ${scope ? sql`and ${scope}` : sql``}`;
    },
  },
  {
    entityType: "document",
    kind: "DOCUMENTS",
    kinds: ["DOCUMENTS"],
    visibleTo: canReadDocuments,
    subjects: ({ workspaceId, assetId }) => sql`
      select 'document'::text, ${documents.id}, 'DOCUMENTS'::text, ${documents.documentNumber}, null::bigint, null::text
      from ${documents}
      where ${documents.workspaceId} = ${workspaceId}
        and ${documents.assetId} = ${assetId}`,
  },
  {
    entityType: "financial_entry",
    kind: "MONEY",
    kinds: ["MONEY"],
    visibleTo: canReadEntries,
    subjects: ({ workspaceId, assetId, auth }) => sql`
      select 'financial_entry'::text, ${financialEntries.id}, 'MONEY'::text, ${financialEntries.entryNumber},
        (
          select sum(${financialPostings.amountMinor}) from ${financialPostings}
          where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
            and ${financialPostings.financialEntryId} = ${financialEntries.id}
            and ${financialPostings.assetId} = ${assetId}
        )::bigint,
        ${financialEntries.currency}::text
      from ${financialEntries}
      where ${financialEntries.workspaceId} = ${workspaceId}
        and exists (
          select 1 from ${financialPostings}
          where ${financialPostings.workspaceId} = ${financialEntries.workspaceId}
            and ${financialPostings.financialEntryId} = ${financialEntries.id}
            and ${financialPostings.assetId} = ${assetId}
        )
        and ${readableEntrySql(auth)}`,
  },
  {
    entityType: "operational_issue",
    kind: "MAINTENANCE",
    kinds: ["MAINTENANCE"],
    subjects: ({ workspaceId, assetId }) => sql`
      select 'operational_issue'::text, ${operationalIssues.id}, 'MAINTENANCE'::text, null::text, null::bigint, null::text
      from ${operationalIssues}
      where ${operationalIssues.workspaceId} = ${workspaceId}
        and ${operationalIssues.assetId} = ${assetId}`,
  },
  {
    entityType: "work_order",
    kind: "MAINTENANCE",
    kinds: ["MAINTENANCE"],
    subjects: ({ workspaceId, assetId }) => sql`
      select 'work_order'::text, ${workOrders.id}, 'MAINTENANCE'::text, null::text, null::bigint, null::text
      from ${workOrders}
      where ${workOrders.workspaceId} = ${workspaceId}
        and ${workOrders.assetId} = ${assetId}`,
  },
  {
    entityType: "asset_availability_interval",
    kind: "MAINTENANCE",
    kinds: ["MAINTENANCE"],
    subjects: ({ workspaceId, assetId }) => sql`
      select 'asset_availability_interval'::text, ${assetAvailabilityIntervals.id}, 'MAINTENANCE'::text, null::text, null::bigint, null::text
      from ${assetAvailabilityIntervals}
      where ${assetAvailabilityIntervals.workspaceId} = ${workspaceId}
        and ${assetAvailabilityIntervals.assetId} = ${assetId}`,
  },
  {
    entityType: "note",
    kind: "NOTES",
    kinds: ["NOTES"],
    subjects: ({ workspaceId, assetId }) => sql`
      select 'note'::text, ${notes.id}, 'NOTES'::text, null::text, null::bigint, null::text
      from ${notes}
      where ${notes.workspaceId} = ${workspaceId}
        and ${notes.entityType} = 'asset'
        and ${notes.entityId} = ${assetId}`,
  },
];

/** The sources this caller may see under this filter: module on, role allowed, kind asked for. */
export function activeSources(
  modules: ReadonlySet<ModuleCode>,
  auth: AuthContext,
  kinds: readonly VehicleHistoryKind[] | undefined,
): HistorySource[] {
  return SOURCES.filter(
    (source) =>
      modules.has(HISTORY_ENTITY_MODULE[source.entityType]) &&
      (source.visibleTo === undefined || source.visibleTo(auth.role)) &&
      (kinds === undefined || source.kinds.some((kind) => kinds.includes(kind))),
  );
}

interface EventRow {
  event_id: string;
  event_type: string;
  occurred_at_key: string;
  scope: "WORKSPACE" | "PLATFORM";
  principal_id: string | null;
  display_name: string | null;
  origin: CommandOrigin;
  command_id: string;
  entity_type: HistoryEntityType;
  entity_id: string;
  ref_number: string | null;
  amount_minor: string | null;
  currency: string | null;
  kind: VehicleHistoryKind;
  note: string | null;
  note_code: string | null;
}

async function pageOfEvents(
  tx: TenantTx,
  context: SourceContext,
  sources: readonly HistorySource[],
  kinds: readonly VehicleHistoryKind[] | undefined,
  cursor: { value: string; id: string } | undefined,
  limit: number,
): Promise<EventRow[]> {
  if (sources.length === 0) return [];
  const subjects = sql.join(
    sources.map((source) => sql`(${source.subjects(context)})`),
    sql` union all `,
  );
  const kindSql = sql`coalesce(s.kind, case when ${auditEvents.eventType} = 'asset.assigned' then 'ASSIGNMENTS' else 'LIFECYCLE' end)`;
  const kindFilter =
    kinds === undefined
      ? sql``
      : sql`and ${kindSql} in (${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)})`;
  const keyset =
    cursor === undefined
      ? sql``
      : sql`and (
          ${auditEvents.occurredAt} < ${cursor.value}::timestamptz
          or (${auditEvents.occurredAt} = ${cursor.value}::timestamptz and ${auditEvents.id} > ${cursor.id}::uuid)
        )`;

  const result = await tx.execute(sql`
    with s(entity_type, entity_id, kind, ref_number, amount_minor, currency) as (${subjects})
    select
      ${auditEvents.id} as event_id,
      ${auditEvents.eventType} as event_type,
      ${occurredAtKeySql} as occurred_at_key,
      ${auditEvents.scope} as scope,
      ${auditEvents.tenantActorPrincipalId} as principal_id,
      ${principals.displayName} as display_name,
      ${commands.origin} as origin,
      ${auditEvents.commandId} as command_id,
      s.entity_type,
      s.entity_id,
      s.ref_number,
      s.amount_minor::text as amount_minor,
      s.currency,
      ${kindSql} as kind,
      ${noteSql()} as note,
      ${noteCodeSql()} as note_code
    from s
    inner join ${auditEvents}
      on ${auditEvents.workspaceId} = ${context.workspaceId}
      and ${auditEvents.entityType} = s.entity_type
      and ${auditEvents.entityId} = s.entity_id
    inner join ${commands}
      on ${commands.workspaceId} = ${auditEvents.workspaceId}
      and ${commands.id} = ${auditEvents.commandId}
    left join ${principals} on ${principals.id} = ${auditEvents.tenantActorPrincipalId}
    where true ${kindFilter} ${keyset}
    order by ${auditEvents.occurredAt} desc, ${auditEvents.id} asc
    limit ${limit + 1}
  `);
  return result.rows as unknown as EventRow[];
}

type Params = VehicleHistoryItem["params"];

const clip = (text: string): string => (text.length > 140 ? `${text.slice(0, 139)}…` : text);

/**
 * The allowlisted facts for a page's events, read from the subject rows — which
 * are immutable facts — and, for `asset.assigned` only, the before/after ids the
 * event moved, resolved to names inside this workspace. One small query per
 * subject type present on the page.
 */
async function pageParams(
  tx: TenantTx,
  workspaceId: string,
  rows: readonly EventRow[],
): Promise<Map<string, Params>> {
  const byEvent = new Map<string, Params>();
  const idsOf = (type: HistoryEntityType) => [
    ...new Set(rows.filter((row) => row.entity_type === type).map((row) => row.entity_id)),
  ];
  const bySubject = new Map<string, Params>();

  const activityIds = idsOf("activity");
  if (activityIds.length > 0) {
    for (const row of await tx
      .select({
        id: activities.id,
        activityNumber: activities.activityNumber,
        customerName: activities.customerName,
      })
      .from(activities)
      .where(and(eq(activities.workspaceId, workspaceId), inArray(activities.id, activityIds)))) {
      bySubject.set(row.id, { activityNumber: row.activityNumber, customerName: row.customerName });
    }
  }

  const legIds = idsOf("movement_leg");
  if (legIds.length > 0) {
    const origin = alias(places, "history_origin_place");
    const destination = alias(places, "history_destination_place");
    for (const row of await tx
      .select({
        id: movementLegs.id,
        originName: sql<string>`coalesce(${origin.name}, ${movementLegs.originText})`,
        destinationName: sql<string>`coalesce(${destination.name}, ${movementLegs.destinationText})`,
        distanceKm: movementLegs.distanceKm,
      })
      .from(movementLegs)
      .leftJoin(
        origin,
        and(eq(origin.workspaceId, movementLegs.workspaceId), eq(origin.id, movementLegs.originPlaceId)),
      )
      .leftJoin(
        destination,
        and(
          eq(destination.workspaceId, movementLegs.workspaceId),
          eq(destination.id, movementLegs.destinationPlaceId),
        ),
      )
      .where(and(eq(movementLegs.workspaceId, workspaceId), inArray(movementLegs.id, legIds)))) {
      bySubject.set(row.id, {
        originName: row.originName,
        destinationName: row.destinationName,
        distanceKm: row.distanceKm,
      });
    }
  }

  const readingIds = idsOf("meter_reading");
  if (readingIds.length > 0) {
    for (const row of await tx
      .select({
        id: meterReadings.id,
        readingType: meterReadings.readingType,
        value: meterReadings.value,
        source: meterReadings.source,
      })
      .from(meterReadings)
      .where(and(eq(meterReadings.workspaceId, workspaceId), inArray(meterReadings.id, readingIds)))) {
      bySubject.set(row.id, {
        readingType: row.readingType,
        value: serializeMinor(row.value),
        source: row.source,
      });
    }
  }

  const documentIds = idsOf("document");
  if (documentIds.length > 0) {
    for (const row of await tx
      .select({
        id: documents.id,
        documentTypeCode: documents.documentTypeCode,
        labelFr: categories.labelFr,
        labelEn: categories.labelEn,
        documentNumber: documents.documentNumber,
        expiresAt: documents.expiresAt,
      })
      .from(documents)
      .leftJoin(
        categories,
        and(
          eq(categories.workspaceId, documents.workspaceId),
          eq(categories.kind, "DOCUMENT_TYPE"),
          eq(categories.code, documents.documentTypeCode),
        ),
      )
      .where(and(eq(documents.workspaceId, workspaceId), inArray(documents.id, documentIds)))) {
      bySubject.set(row.id, {
        documentTypeLabelFr: row.labelFr ?? row.documentTypeCode,
        documentTypeLabelEn: row.labelEn ?? row.documentTypeCode,
        documentNumber: row.documentNumber,
        expiresAt: row.expiresAt,
      });
    }
  }

  const entryIds = idsOf("financial_entry");
  if (entryIds.length > 0) {
    for (const row of await tx
      .select({
        id: financialEntries.id,
        entryNumber: financialEntries.entryNumber,
        direction: financialEntries.direction,
        status: financialEntries.status,
        labelFr: categories.labelFr,
        labelEn: categories.labelEn,
      })
      .from(financialEntries)
      .innerJoin(
        categories,
        and(eq(categories.workspaceId, financialEntries.workspaceId), eq(categories.id, financialEntries.categoryId)),
      )
      .where(and(eq(financialEntries.workspaceId, workspaceId), inArray(financialEntries.id, entryIds)))) {
      bySubject.set(row.id, {
        entryNumber: row.entryNumber,
        direction: row.direction,
        categoryLabelFr: row.labelFr,
        categoryLabelEn: row.labelEn,
        status: row.status,
      });
    }
  }

  const issueIds = idsOf("operational_issue");
  if (issueIds.length > 0) {
    for (const row of await tx
      .select({
        id: operationalIssues.id,
        description: operationalIssues.description,
        safetyCritical: operationalIssues.safetyCritical,
      })
      .from(operationalIssues)
      .where(and(eq(operationalIssues.workspaceId, workspaceId), inArray(operationalIssues.id, issueIds)))) {
      bySubject.set(row.id, { description: clip(row.description), safetyCritical: row.safetyCritical });
    }
  }

  const orderIds = idsOf("work_order");
  if (orderIds.length > 0) {
    for (const row of await tx
      .select({ id: workOrders.id, description: workOrders.description })
      .from(workOrders)
      .where(and(eq(workOrders.workspaceId, workspaceId), inArray(workOrders.id, orderIds)))) {
      bySubject.set(row.id, { description: clip(row.description) });
    }
  }

  const intervalIds = idsOf("asset_availability_interval");
  if (intervalIds.length > 0) {
    for (const row of await tx
      .select({ id: assetAvailabilityIntervals.id, issueDescription: operationalIssues.description })
      .from(assetAvailabilityIntervals)
      .innerJoin(
        operationalIssues,
        and(
          eq(operationalIssues.workspaceId, assetAvailabilityIntervals.workspaceId),
          eq(operationalIssues.id, assetAvailabilityIntervals.openedByIssueId),
        ),
      )
      .where(
        and(
          eq(assetAvailabilityIntervals.workspaceId, workspaceId),
          inArray(assetAvailabilityIntervals.id, intervalIds),
        ),
      )) {
      bySubject.set(row.id, { issueDescription: clip(row.issueDescription) });
    }
  }

  const noteIds = idsOf("note");
  if (noteIds.length > 0) {
    for (const row of await tx
      .select({ id: notes.id, body: notes.body })
      .from(notes)
      .where(and(eq(notes.workspaceId, workspaceId), inArray(notes.id, noteIds)))) {
      bySubject.set(row.id, { body: row.body });
    }
  }

  // Files per `evidence_attached` call, counted from that call's own links.
  const attachCalls = [
    ...new Set(
      rows
        .filter((row) => row.event_type === "financial_entry.evidence_attached")
        .map((row) => row.command_id),
    ),
  ];
  const filesPerCall = new Map<string, number>();
  if (attachCalls.length > 0) {
    for (const row of await tx
      .select({
        commandId: commandSourceArtifacts.commandId,
        count: sql<number>`count(*)::int`,
      })
      .from(commandSourceArtifacts)
      .where(
        and(
          eq(commandSourceArtifacts.workspaceId, workspaceId),
          inArray(commandSourceArtifacts.commandId, attachCalls),
        ),
      )
      .groupBy(commandSourceArtifacts.commandId)) {
      filesPerCall.set(row.commandId, row.count);
    }
  }

  const assignments = await assignmentParams(
    tx,
    workspaceId,
    rows.filter((row) => row.event_type === "asset.assigned").map((row) => row.event_id),
  );
  const severities = await severityAtEvent(
    tx,
    workspaceId,
    rows.filter((row) => SEVERITY_EVENTS.has(row.event_type)).map((row) => row.event_id),
  );

  for (const row of rows) {
    const params: Params = { ...(bySubject.get(row.entity_id) ?? {}) };
    if (row.event_type === "financial_entry.evidence_attached") {
      params["artifactCount"] = filesPerCall.get(row.command_id) ?? 0;
    }
    const severity = severities.get(row.event_id);
    if (severity !== undefined) params["safetyCritical"] = severity;
    Object.assign(params, assignments.get(row.event_id) ?? {});
    byEvent.set(row.event_id, params);
  }
  return byEvent;
}

/** The issue events that state a severity: the report and each change of it (#96). */
const SEVERITY_EVENTS = new Set([
  "operational_issue.reported",
  "operational_issue.severity_raised",
  "operational_issue.severity_lowered",
]);

/**
 * The safety-critical mark as each event left it. The issue row holds only the
 * current mark, and a report later marked safety-critical was not reported so:
 * the timeline shows the severity each event recorded (#96).
 */
async function severityAtEvent(
  tx: TenantTx,
  workspaceId: string,
  eventIds: readonly string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (eventIds.length === 0) return result;
  for (const event of await tx
    .select({ id: auditEvents.id, afterState: auditEvents.afterState })
    .from(auditEvents)
    .where(and(eq(auditEvents.workspaceId, workspaceId), inArray(auditEvents.id, [...eventIds])))) {
    const after = event.afterState as Record<string, unknown> | null;
    const value = after?.["safetyCritical"];
    if (typeof value === "boolean") result.set(event.id, value);
  }
  return result;
}

/** The event a details edit writes (`update-asset-details`). */
const DETAILS_UPDATED = "asset.details_updated";

/**
 * What each details edit on the page changed, from its own before and after
 * through the record history's allowlist. Money fields stay with the roles
 * that read the books in a workspace running finance — the people the card
 * shows the acquisition amount to.
 */
async function detailChanges(
  tx: TenantTx,
  workspaceId: string,
  rows: readonly EventRow[],
  showMoney: boolean,
): Promise<Map<string, HistoryFieldChange[]>> {
  const result = new Map<string, HistoryFieldChange[]>();
  const eventIds = rows.filter((row) => row.event_type === DETAILS_UPDATED).map((row) => row.event_id);
  if (eventIds.length === 0) return result;
  for (const event of await tx
    .select({ id: auditEvents.id, beforeState: auditEvents.beforeState, afterState: auditEvents.afterState })
    .from(auditEvents)
    .where(and(eq(auditEvents.workspaceId, workspaceId), inArray(auditEvents.id, eventIds)))) {
    result.set(
      event.id,
      diffStates("asset", event.beforeState, event.afterState).filter(
        (change) => showMoney || change.kind !== "MONEY",
      ),
    );
  }
  return result;
}

const uuidOrNull = (value: unknown): string | null =>
  typeof value === "string" && z.uuid().safeParse(value).success ? value : null;

/**
 * Who held the vehicle and where it stood, before and after each assignment.
 * The snapshots are read for two id keys only, and every id resolves through a
 * join scoped to this workspace — a stray id names nothing.
 */
async function assignmentParams(
  tx: TenantTx,
  workspaceId: string,
  eventIds: readonly string[],
): Promise<Map<string, Params>> {
  const result = new Map<string, Params>();
  if (eventIds.length === 0) return result;
  const events = await tx
    .select({ id: auditEvents.id, beforeState: auditEvents.beforeState, afterState: auditEvents.afterState })
    .from(auditEvents)
    .where(and(eq(auditEvents.workspaceId, workspaceId), inArray(auditEvents.id, [...eventIds])));

  const pick = (state: unknown, key: string): string | null =>
    state !== null && typeof state === "object" && !Array.isArray(state)
      ? uuidOrNull((state as Record<string, unknown>)[key])
      : null;
  const moves = events.map((event) => ({
    id: event.id,
    custodian: pick(event.afterState, "custodianMembershipId"),
    previousCustodian: pick(event.beforeState, "custodianMembershipId"),
    branch: pick(event.afterState, "branchId"),
    previousBranch: pick(event.beforeState, "branchId"),
  }));

  const membershipIds = [
    ...new Set(moves.flatMap((move) => [move.custodian, move.previousCustodian]).filter((id) => id !== null)),
  ];
  const names = new Map<string, string>();
  if (membershipIds.length > 0) {
    for (const row of await tx
      .select({ id: memberships.id, displayName: principals.displayName })
      .from(memberships)
      .innerJoin(principals, eq(principals.id, memberships.principalId))
      .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.id, membershipIds)))) {
      names.set(row.id, row.displayName);
    }
  }
  const branchIds = [
    ...new Set(moves.flatMap((move) => [move.branch, move.previousBranch]).filter((id) => id !== null)),
  ];
  const codes = new Map<string, string>();
  if (branchIds.length > 0) {
    for (const row of await tx
      .select({ id: branches.id, code: branches.code })
      .from(branches)
      .where(and(eq(branches.workspaceId, workspaceId), inArray(branches.id, branchIds)))) {
      codes.set(row.id, row.code);
    }
  }

  const lookup = (map: Map<string, string>, id: string | null) => (id === null ? null : (map.get(id) ?? null));
  for (const move of moves) {
    result.set(move.id, {
      custodianDisplayName: lookup(names, move.custodian),
      previousCustodianDisplayName: lookup(names, move.previousCustodian),
      branchCode: lookup(codes, move.branch),
      previousBranchCode: lookup(codes, move.previousBranch),
    });
  }
  return result;
}

export function registerAssetHistoryReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * Everything that happened to the vehicle and the records it owns, newest
   * first, filterable by kind. Gated by ASSETS; each source by its own module
   * and `visibleTo`, MONEY entries by the caller's money scope and a detail
   * edit's purchase price by the ledger.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/assets/:assetId/history", module: "ASSETS", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, modules, read }) => {
      try {
        const params = z.object({ assetId: z.uuid() }).safeParse(req.params);
        const query = vehicleHistoryQuery.safeParse(req.query);
        if (!params.success || !query.success) throw invalidRequest();
        const { assetId } = params.data;
        const { kind: kinds, cursor, limit } = query.data;

        const position = cursor ? decodeTimestampCursor(cursor, historySort) : undefined;
        if (cursor && !position) throw invalidRequest();

        const page = await read(async (tx) => {
          await requireScopedAsset(tx, auth, assetId);
          const context = { workspaceId: auth.workspaceId, assetId, auth };
          const sources = activeSources(modules, auth, kinds);
          const rows = await pageOfEvents(tx, context, sources, kinds, position, limit);
          const pageRows = rows.slice(0, limit);
          const paramsByEvent = await pageParams(tx, auth.workspaceId, pageRows);
          const changesByEvent = await detailChanges(
            tx,
            auth.workspaceId,
            pageRows,
            canReadLedger(auth.role) && modules.has("FINANCE"),
          );
          return { rows, pageRows, paramsByEvent, changesByEvent };
        });

        const items: VehicleHistoryItem[] = page.pageRows.map((row) => ({
          eventId: row.event_id,
          eventType: row.event_type,
          kind: row.kind,
          occurredAt: new Date(row.occurred_at_key).toISOString(),
          actor: toActor({ principalId: row.principal_id, displayName: row.display_name, scope: row.scope }),
          origin: row.origin,
          subject: { entityType: row.entity_type, id: row.entity_id, number: row.ref_number },
          amountMinor:
            row.kind === "MONEY" && row.amount_minor !== null ? serializeMinor(BigInt(row.amount_minor)) : null,
          currency: row.kind === "MONEY" ? row.currency : null,
          params: page.paramsByEvent.get(row.event_id) ?? {},
          note: row.note,
          noteCode: row.note_code,
          ...(row.event_type === DETAILS_UPDATED
            ? { changes: page.changesByEvent.get(row.event_id) ?? [] }
            : {}),
        }));

        const last = page.pageRows[page.pageRows.length - 1];
        const nextCursor =
          page.rows.length > limit && last
            ? encodeKeysetCursor(historySort, last.occurred_at_key, last.event_id)
            : null;

        return vehicleHistoryResponse.parse({ items, nextCursor });
      } catch (error) {
        return sendReadFailure(req, reply, error, "vehicle history");
      }
    },
  );
}
