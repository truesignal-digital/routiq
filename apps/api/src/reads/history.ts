import { isDeepStrictEqual } from "node:util";
import {
  canReadDocuments,
  canReadLedger,
  canReadWorkOrderCosts,
  moneyReadScope,
  HISTORY_ENTITY_MODULE,
  HISTORY_MONEY_STATE_KEYS,
  HISTORY_STATE_KEYS,
  historyEntityType,
  historyEventDiff,
  historyListQuery,
  historyListResponse,
  type HistoryEntityType,
  type HistoryFieldChange,
  type ListSort,
} from "@routiq/contracts";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import {
  activities,
  activityAssetSegments,
  assetAvailabilityIntervals,
  assets,
  auditEvents,
  commands,
  documents,
  financialEntries,
  meterReadings,
  movementLegs,
  notes,
  operationalIssues,
  persons,
  principals,
  workOrders,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { presentChanges } from "./history-present.js";
import { isModuleEnabled } from "../modules/registry.js";
import { canReadEntry } from "./money-scope.js";
import {
  afterKeyset,
  bindTimestampText,
  decodeTimestampCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  microsecondKey,
  type KeysetColumn,
} from "./cursor.js";
import { ANY_ROLE, defineRead } from "./define-read.js";

/**
 * Newest first, always. A timeline has one meaningful order, so the sort is not
 * a client choice — but the cursor still carries it, because `decodeKeysetCursor`
 * refuses a boundary minted under any other ordering.
 */
const historySort: ListSort<"occurredAt"> = {
  field: "occurredAt",
  direction: "desc",
};

/**
 * The events of one command share a transaction timestamp to the microsecond,
 * so the cursor carries it at that precision: a millisecond boundary would
 * skip the rest of a command split across two pages.
 */
const occurredAtColumn: KeysetColumn = {
  column: auditEvents.occurredAt,
  bind: bindTimestampText,
};

/**
 * State keys that may surface as the timeline's `note` — an allowlist, never a
 * passthrough. `after_state` is a row snapshot: future user-management events
 * will put credential material in there, and nothing reaches a client from it
 * except a key named here.
 */
const NOTE_STATE_KEYS = ["reason"] as const;

/** A reason picked from a list (#426): a code the client words, never shown raw. */
const NOTE_CODE_STATE_KEYS = ["reasonCode"] as const;

/**
 * The first allowlisted key holding a JSON string. The `jsonb_typeof` guard
 * matters: `->>` would happily serialise an object into the note line.
 */
function firstStringSql(keys: readonly string[]): SQL<string | null> {
  const candidates = keys.map(
    (key) =>
      sql`case when jsonb_typeof(${auditEvents.afterState} -> ${key}::text) = 'string'
               then ${auditEvents.afterState} ->> ${key}::text end`,
  );
  return sql<string | null>`coalesce(${sql.join(candidates, sql`, `)}, null)`;
}

export function noteSql(): SQL<string | null> {
  return firstStringSql(NOTE_STATE_KEYS);
}

export function noteCodeSql(): SQL<string | null> {
  return firstStringSql(NOTE_CODE_STATE_KEYS);
}

/**
 * Key names that never leave this process, at any depth, whatever an allowlist
 * says. The allowlist is the gate; this is the second lock on it — a snapshot
 * that starts carrying a PIN hash under an already-allowed key (say inside
 * `crew`) is caught here rather than shipped.
 */
const CREDENTIAL_KEY_PATTERN =
  /pin|password|passphrase|secret|token|credential|hash|salt|otp|api[-_]?key|private[-_]?key/i;

const MONEY_STATE_KEYS = new Set<string>(HISTORY_MONEY_STATE_KEYS);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Drops credential-shaped keys from nested objects; arrays keep their shape. */
function stripCredentials(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stripCredentials);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, JsonValue>)
      .filter(([key]) => !CREDENTIAL_KEY_PATTERN.test(key))
      .map(([key, nested]) => [key, stripCredentials(nested)]),
  );
}

/**
 * A snapshot reduced to what this entity type is allowed to show. Anything the
 * allowlist does not name is gone before the row leaves the read — the response
 * is built from this, never from the raw state.
 */
function projectState(
  entityType: HistoryEntityType,
  state: unknown,
): Record<string, JsonValue> {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return {};
  const snapshot = state as Record<string, JsonValue>;
  const projected: Record<string, JsonValue> = {};
  for (const key of HISTORY_STATE_KEYS[entityType]) {
    if (!Object.hasOwn(snapshot, key)) continue;
    if (CREDENTIAL_KEY_PATTERN.test(key)) continue;
    projected[key] = stripCredentials(snapshot[key] ?? null);
  }
  return projected;
}

/**
 * The fields that actually moved, in allowlist order. A missing key and a JSON
 * null read the same here: a creation event has no `before_state`, so every
 * field it recorded shows up as "was nothing, is now this".
 */
export function diffStates(
  entityType: HistoryEntityType,
  beforeState: unknown,
  afterState: unknown,
): HistoryFieldChange[] {
  const before = projectState(entityType, beforeState);
  const after = projectState(entityType, afterState);

  const changes: HistoryFieldChange[] = [];
  for (const field of HISTORY_STATE_KEYS[entityType]) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (isDeepStrictEqual(from, to)) continue;
    changes.push({
      field,
      kind: MONEY_STATE_KEYS.has(field) ? "MONEY" : "VALUE",
      before: from,
      after: to,
    });
  }
  return changes;
}

/** The currency the money fields in this event are denominated in. */
function diffCurrency(
  beforeState: unknown,
  afterState: unknown,
  workspaceDefault: string,
): string {
  for (const state of [afterState, beforeState]) {
    if (state === null || typeof state !== "object") continue;
    const currency = (state as Record<string, unknown>)["currency"];
    if (typeof currency === "string" && currency.length === 3) return currency;
  }
  return workspaceDefault;
}

/**
 * The branch a record belongs to, for the types that have one — their own, or
 * their parent's. Undefined when the record does not exist.
 */
type BranchOf = (tx: TenantTx, workspaceId: string, entityId: string) => Promise<string | undefined>;

async function first(rows: Promise<Array<{ branchId: string }>>): Promise<string | undefined> {
  return (await rows)[0]?.branchId;
}

const byAsset: BranchOf = (tx, workspaceId, assetId) =>
  first(
    tx
      .select({ branchId: assets.branchId })
      .from(assets)
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, assetId)))
      .limit(1),
  );

const byActivity: BranchOf = (tx, workspaceId, entityId) =>
  first(
    tx
      .select({ branchId: activities.branchId })
      .from(activities)
      .where(and(eq(activities.workspaceId, workspaceId), eq(activities.id, entityId)))
      .limit(1),
  );

/** A child row whose branch is its activity's. */
function viaActivity(
  table: typeof activityAssetSegments | typeof movementLegs,
): BranchOf {
  return (tx, workspaceId, entityId) =>
    first(
      tx
        .select({ branchId: activities.branchId })
        .from(table)
        .innerJoin(
          activities,
          and(eq(activities.workspaceId, table.workspaceId), eq(activities.id, table.activityId)),
        )
        .where(and(eq(table.workspaceId, workspaceId), eq(table.id, entityId)))
        .limit(1),
    );
}

/** A maintenance, document or note row whose branch is its asset's. */
function viaAsset(
  table:
    | typeof documents
    | typeof workOrders
    | typeof operationalIssues
    | typeof assetAvailabilityIntervals
    | typeof notes,
): BranchOf {
  return (tx, workspaceId, entityId) =>
    first(
      tx
        .select({ branchId: assets.branchId })
        .from(table)
        .innerJoin(
          assets,
          and(eq(assets.workspaceId, table.workspaceId), eq(assets.id, table.assetId)),
        )
        .where(and(eq(table.workspaceId, workspaceId), eq(table.id, entityId)))
        .limit(1),
    );
}

/**
 * A reading taken during a job belongs to the job's branch — where it was
 * recorded and who may see the job; a standalone reading to its asset's.
 */
const byMeterReading: BranchOf = async (tx, workspaceId, entityId) => {
  const [reading] = await tx
    .select({ assetId: meterReadings.assetId, activityId: meterReadings.activityId })
    .from(meterReadings)
    .where(and(eq(meterReadings.workspaceId, workspaceId), eq(meterReadings.id, entityId)))
    .limit(1);
  if (!reading) return undefined;
  return reading.activityId === null
    ? byAsset(tx, workspaceId, reading.assetId)
    : byActivity(tx, workspaceId, reading.activityId);
};

const byPerson: BranchOf = (tx, workspaceId, entityId) =>
  first(
    tx
      .select({ branchId: persons.branchId })
      .from(persons)
      .where(and(eq(persons.workspaceId, workspaceId), eq(persons.id, entityId)))
      .limit(1),
  );

const byFinancialEntry: BranchOf = (tx, workspaceId, entityId) =>
  first(
    tx
      .select({ branchId: financialEntries.branchId })
      .from(financialEntries)
      .where(and(eq(financialEntries.workspaceId, workspaceId), eq(financialEntries.id, entityId)))
      .limit(1),
  );

/**
 * Branch scope per history entity type (#58), explicit for every type so a new
 * one cannot fall through to "allow": the Record's key set is the closed
 * entity vocabulary, and `WORKSPACE` must be chosen on purpose. Workspace-level
 * types have no branch; the module gate and RLS are their whole rule.
 */
const HISTORY_BRANCH_SCOPE: Record<HistoryEntityType, BranchOf | "WORKSPACE"> = {
  activity: byActivity,
  activity_asset_segment: viaActivity(activityAssetSegments),
  approval_rule: "WORKSPACE",
  asset: byAsset,
  asset_availability_interval: viaAsset(assetAvailabilityIntervals),
  category: "WORKSPACE",
  document: viaAsset(documents),
  financial_entry: byFinancialEntry,
  meter_reading: byMeterReading,
  movement_leg: viaActivity(movementLegs),
  note: viaAsset(notes),
  operational_issue: viaAsset(operationalIssues),
  person: byPerson,
  posting_period: "WORKSPACE",
  work_order: viaAsset(workOrders),
  workspace: "WORKSPACE",
  workspace_module: "WORKSPACE",
  workspace_template: "WORKSPACE",
};

/**
 * Whether the actor may read this record's history. Outside their branches the
 * answer is the same 404 the record's detail read gives — the timeline is not a
 * side door to data the detail withholds. Checked against the branch the record
 * belongs to NOW (an asset transferred away takes its history with it).
 *
 * An entry's snapshots carry its amounts, so its timeline follows the
 * caller's money scope (`readableEntrySql`): a driver's own entries, the
 * workshop's work-order costs; any other entry is the same 404. A document's
 * timeline is for the roles that read documents.
 */
async function canReadHistory(
  tx: TenantTx,
  auth: AuthContext,
  entityType: HistoryEntityType,
  entityId: string,
): Promise<boolean> {
  const scope = HISTORY_BRANCH_SCOPE[entityType];
  if (scope !== "WORKSPACE" && auth.branchScope !== "ALL") {
    const branchId = await scope(tx, auth.workspaceId, entityId);
    if (branchId === undefined || !auth.branchScope.includes(branchId)) return false;
  }
  if (entityType === "financial_entry") {
    // The branch check above is the whole rule for the ledger and the counter.
    const scope = moneyReadScope(auth.role);
    if (scope === "OWN_ENTRIES" || scope === "WORK_ORDER_COSTS") {
      return canReadEntry(tx, auth, entityId);
    }
  }
  if (entityType === "document") return canReadDocuments(auth.role);
  return true;
}

export function registerHistoryReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * History is visible to whoever can read the record: the gate is the owning
   * module's entitlement plus RLS and the record's branch scope, with the
   * per-role rules on top — money scope and documents (`canReadHistory`). Field staff
   * seeing "the office corrected my sheet" is the point, not a leak.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/history/:entityType/:entityId", module: "CORE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedParams = z
          .object({ entityType: historyEntityType, entityId: z.uuid() })
          .safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { entityType, entityId } = parsedParams.data;

        const parsedQuery = historyListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { cursor, limit } = parsedQuery.data;

        const moduleCode = HISTORY_ENTITY_MODULE[entityType];

        const result = await read(async (tx) => {
          if (!(await isModuleEnabled(tx, auth.workspaceId, moduleCode))) {
            return { error: "MODULE_DISABLED" as const };
          }
          if (!(await canReadHistory(tx, auth, entityType, entityId))) {
            return { error: "REFERENCE_NOT_FOUND" as const };
          }

          const decodedCursor = cursor
            ? decodeTimestampCursor(cursor, historySort)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          const conditions: SQL[] = [
            eq(auditEvents.workspaceId, auth.workspaceId),
            eq(auditEvents.entityType, entityType),
            eq(auditEvents.entityId, entityId),
          ];
          if (decodedCursor) {
            conditions.push(
              afterKeyset(
                occurredAtColumn,
                historySort.direction,
                auditEvents.id,
                decodedCursor,
              ),
            );
          }

          const rows = await tx
            .select({
              eventId: auditEvents.id,
              eventType: auditEvents.eventType,
              occurredAt: auditEvents.occurredAt,
              occurredAtKey: microsecondKey(auditEvents.occurredAt),
              scope: auditEvents.scope,
              // The generated masking column, not `actor_principal_id`: it is
              // NULL for PLATFORM events, so the principals join finds nothing
              // and the vendor operator's identity never crosses the tenant line.
              actorPrincipalId: auditEvents.tenantActorPrincipalId,
              actorDisplayName: principals.displayName,
              commandId: commands.id,
              commandName: commands.commandType,
              commandVersion: commands.commandVersion,
              origin: commands.origin,
              clientOccurredAt: commands.clientOccurredAt,
              changedFields: auditEvents.changedFields,
              note: noteSql(),
              noteCode: noteCodeSql(),
            })
            .from(auditEvents)
            .innerJoin(
              commands,
              and(
                eq(commands.workspaceId, auditEvents.workspaceId),
                eq(commands.id, auditEvents.commandId),
              ),
            )
            .leftJoin(
              principals,
              eq(principals.id, auditEvents.tenantActorPrincipalId),
            )
            .where(and(...conditions))
            .orderBy(
              ...keysetOrderBy(
                occurredAtColumn,
                historySort.direction,
                auditEvents.id,
              ),
            )
            .limit(limit + 1);

          return { rows };
        });

        if ("error" in result) {
          if (result.error === "REFERENCE_NOT_FOUND") {
            return reply.status(404).send({ error: { code: result.error } });
          }
          return result.error === "MODULE_DISABLED"
            ? reply.status(403).send({
                error: { code: "MODULE_DISABLED", metadata: { module: moduleCode } },
              })
            : reply.status(400).send({ error: { code: result.error } });
        }

        const hasNextPage = result.rows.length > limit;
        const pageRows = result.rows.slice(0, limit);
        const items = pageRows.map((row) => ({
          eventId: row.eventId,
          eventType: row.eventType,
          occurredAt: row.occurredAt.toISOString(),
          actor: {
            principalId: row.actorPrincipalId,
            displayName: row.actorDisplayName,
            scope: row.scope,
          },
          command: {
            id: row.commandId,
            name: row.commandName,
            version: row.commandVersion,
            origin: row.origin,
            clientOccurredAt: row.clientOccurredAt?.toISOString() ?? null,
          },
          changedFields: row.changedFields ?? [],
          note: row.note,
          noteCode: row.noteCode,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(historySort, lastRow.occurredAtKey, lastRow.eventId);
        }

        return historyListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "record history read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  /**
   * What one event changed. Same gate as the timeline it hangs off — owning
   * module, RLS, branch scope and the money scope — and the same rule about the snapshots: they are projected
   * through `HISTORY_STATE_KEYS` here and never served raw.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/history/:entityType/:entityId/:eventId", module: "CORE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, modules, read }) => {
      try {
        const parsedParams = z
          .object({
            entityType: historyEntityType,
            entityId: z.uuid(),
            eventId: z.uuid(),
          })
          .safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { entityType, entityId, eventId } = parsedParams.data;

        const moduleCode = HISTORY_ENTITY_MODULE[entityType];

        const result = await read(async (tx) => {
          if (!(await isModuleEnabled(tx, auth.workspaceId, moduleCode))) {
            return { error: "MODULE_DISABLED" as const };
          }
          if (!(await canReadHistory(tx, auth, entityType, entityId))) {
            return { error: "REFERENCE_NOT_FOUND" as const };
          }

          const [row] = await tx
            .select({
              eventId: auditEvents.id,
              beforeState: auditEvents.beforeState,
              afterState: auditEvents.afterState,
              workspaceCurrency: workspaces.defaultCurrency,
            })
            .from(auditEvents)
            .innerJoin(
              workspaces,
              eq(workspaces.id, auditEvents.workspaceId),
            )
            .where(
              and(
                eq(auditEvents.workspaceId, auth.workspaceId),
                eq(auditEvents.entityType, entityType),
                eq(auditEvents.entityId, entityId),
                eq(auditEvents.id, eventId),
              ),
            )
            .limit(1);
          if (!row) return { row };

          // A vehicle's purchase price is a ledger figure (#121): the same rule
          // as the vehicle's own detail and its History tab. A work order's
          // amounts follow the work-order reads (#390). Posting-line totals are
          // money too, under the same rule.
          const hidesMoney =
            (entityType === "asset" && !(canReadLedger(auth.role) && modules.has("FINANCE"))) ||
            (entityType === "work_order" && !canReadWorkOrderCosts(auth.role));
          const changes = await presentChanges(
            tx,
            auth.workspaceId,
            entityType,
            diffStates(entityType, row.beforeState, row.afterState),
            { showMoney: !hidesMoney },
          );
          return { row, changes };
        });

        if ("error" in result) {
          if (result.error === "REFERENCE_NOT_FOUND") {
            return reply.status(404).send({ error: { code: result.error } });
          }
          return reply.status(403).send({
            error: { code: "MODULE_DISABLED", metadata: { module: moduleCode } },
          });
        }
        if (!result.row) {
          return reply.status(404).send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }

        const { beforeState, afterState, workspaceCurrency } = result.row;
        return historyEventDiff.parse({
          eventId: result.row.eventId,
          currency: diffCurrency(beforeState, afterState, workspaceCurrency),
          changes: result.changes,
        });
      } catch (error) {
        req.log.error({ err: error }, "record history diff read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
