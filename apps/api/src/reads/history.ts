import { isDeepStrictEqual } from "node:util";
import {
  FINANCE_READ_ROLES,
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
  type Role,
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
  assets,
  auditEvents,
  commands,
  documents,
  financialEntries,
  meterReadings,
  movementLegs,
  persons,
  principals,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { ANY_ROLE, defineRead } from "./define-read.js";
import { isModuleEnabled } from "../modules/registry.js";
import {
  afterKeyset,
  bindTimestamp,
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  type KeysetColumn,
} from "./cursor.js";

/**
 * Newest first, always. A timeline has one meaningful order, so the sort is not
 * a client choice — but the cursor still carries it, because `decodeKeysetCursor`
 * refuses a boundary minted under any other ordering.
 */
const historySort: ListSort<"occurredAt"> = {
  field: "occurredAt",
  direction: "desc",
};

const occurredAtColumn: KeysetColumn = {
  column: auditEvents.occurredAt,
  bind: bindTimestamp,
};

/**
 * State keys that may surface as the timeline's `note` — an allowlist, never a
 * passthrough. `after_state` is a row snapshot: future user-management events
 * will put credential material in there, and nothing reaches a client from it
 * except a key named here.
 */
const NOTE_STATE_KEYS = ["reason"] as const;

/**
 * The first allowlisted key holding a JSON string. The `jsonb_typeof` guard
 * matters: `->>` would happily serialise an object into the note line.
 */
function noteSql(): SQL<string | null> {
  const candidates = NOTE_STATE_KEYS.map(
    (key) =>
      sql`case when jsonb_typeof(${auditEvents.afterState} -> ${key}::text) = 'string'
               then ${auditEvents.afterState} ->> ${key}::text end`,
  );
  return sql<string | null>`coalesce(${sql.join(candidates, sql`, `)}, null)`;
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

type BranchLookup = (tx: TenantTx, workspaceId: string, entityId: string) => Promise<
  { found: false } | { found: true; branchId: string | null }
>;

function ownBranch(table: typeof assets | typeof activities | typeof persons | typeof financialEntries): BranchLookup {
  return async (tx, workspaceId, entityId) => {
    const [row] = await tx
      .select({ branchId: table.branchId })
      .from(table)
      .where(and(eq(table.workspaceId, workspaceId), eq(table.id, entityId)))
      .limit(1);
    return row === undefined ? { found: false } : { found: true, branchId: row.branchId };
  };
}

function assetBranch(table: typeof documents | typeof meterReadings): BranchLookup {
  return async (tx, workspaceId, entityId) => {
    const [row] = await tx
      .select({ branchId: assets.branchId })
      .from(table)
      .innerJoin(assets, and(eq(assets.workspaceId, table.workspaceId), eq(assets.id, table.assetId)))
      .where(and(eq(table.workspaceId, workspaceId), eq(table.id, entityId)))
      .limit(1);
    return row === undefined ? { found: false } : { found: true, branchId: row.branchId };
  };
}

function activityBranch(table: typeof activityAssetSegments | typeof movementLegs): BranchLookup {
  return async (tx, workspaceId, entityId) => {
    const [row] = await tx
      .select({ branchId: activities.branchId })
      .from(table)
      .innerJoin(
        activities,
        and(eq(activities.workspaceId, table.workspaceId), eq(activities.id, table.activityId)),
      )
      .where(and(eq(table.workspaceId, workspaceId), eq(table.id, entityId)))
      .limit(1);
    return row === undefined ? { found: false } : { found: true, branchId: row.branchId };
  };
}

/**
 * How each history entity type reaches a branch (#58). Exhaustive by type, so a
 * new entity type cannot ship without saying whether its history is
 * branch-scoped; "workspace" types have no branch and stay visible to every
 * member who may read their module.
 */
const HISTORY_BRANCH: Record<HistoryEntityType, BranchLookup | "workspace"> = {
  activity: ownBranch(activities),
  activity_asset_segment: activityBranch(activityAssetSegments),
  approval_rule: "workspace",
  asset: ownBranch(assets),
  category: "workspace",
  document: assetBranch(documents),
  financial_entry: ownBranch(financialEntries),
  meter_reading: assetBranch(meterReadings),
  movement_leg: activityBranch(movementLegs),
  person: ownBranch(persons),
  posting_period: "workspace",
  workspace: "workspace",
  workspace_module: "workspace",
  workspace_template: "workspace",
};

/** Outside the caller's branches a record's history answers 404, like its detail read. */
async function canReadHistory(tx: TenantTx, auth: AuthContext, entityType: HistoryEntityType, entityId: string) {
  const lookup = HISTORY_BRANCH[entityType];
  if (lookup === "workspace" || auth.branchScope === "ALL") return true;
  const record = await lookup(tx, auth.workspaceId, entityId);
  if (!record.found) return false;
  return record.branchId === null || auth.branchScope.includes(record.branchId);
}

/** Finance history is finance data: the same roles as the finance reads (#59). */
function mayReadHistoryOf(auth: AuthContext, entityType: HistoryEntityType): boolean {
  return (
    HISTORY_ENTITY_MODULE[entityType] !== "FINANCE" ||
    (FINANCE_READ_ROLES as readonly Role[]).includes(auth.role)
  );
}

export function registerHistoryReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  /**
   * History is visible to whoever can read the record: the owning module's
   * entitlement, RLS, the record's branch scope (HISTORY_BRANCH) and, for
   * finance records only, the finance read roles. Field staff seeing "the
   * office corrected my sheet" is the point, not a leak.
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

        if (!mayReadHistoryOf(auth, entityType)) {
          return reply.status(403).send({ error: { code: "ROLE_FORBIDDEN" } });
        }
        const moduleCode = HISTORY_ENTITY_MODULE[entityType];

        const result = await read(async (tx) => {
          if (!(await isModuleEnabled(tx, auth.workspaceId, moduleCode))) {
            return { error: "MODULE_DISABLED" as const };
          }
          if (!(await canReadHistory(tx, auth, entityType, entityId))) {
            return { error: "REFERENCE_NOT_FOUND" as const };
          }

          const decodedCursor = cursor
            ? decodeKeysetCursor(cursor, historySort)
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
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(
            historySort,
            lastRow.occurredAt.toISOString(),
            lastRow.eventId,
          );
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
   * module, RLS, branch scope and finance roles — and the same rule about the snapshots: they are projected
   * through `HISTORY_STATE_KEYS` here and never served raw.
   */
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/history/:entityType/:entityId/:eventId", module: "CORE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
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

        if (!mayReadHistoryOf(auth, entityType)) {
          return reply.status(403).send({ error: { code: "ROLE_FORBIDDEN" } });
        }
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

          return { row };
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
          changes: diffStates(entityType, beforeState, afterState),
        });
      } catch (error) {
        req.log.error({ err: error }, "record history diff read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}
