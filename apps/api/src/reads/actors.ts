import type { HistoryActor } from "@routiq/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auditEvents, commands, principals } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/**
 * Who did something, as a tenant may see it. Every lookup here goes through the
 * generated `tenant_actor_principal_id` columns, which are NULL for PLATFORM
 * rows: the principals join then finds nothing and the vendor operator's
 * identity never crosses the tenant line — the history read's rule.
 */
export interface ActorRow {
  principalId: string | null;
  displayName: string | null;
  scope: "WORKSPACE" | "PLATFORM";
}

export function toActor(row: ActorRow): HistoryActor {
  return { principalId: row.principalId, displayName: row.displayName, scope: row.scope };
}

/** The masked initiator of each command receipt, keyed by command id. */
export async function commandActors(
  tx: TenantTx,
  workspaceId: string,
  commandIds: readonly string[],
): Promise<Map<string, HistoryActor>> {
  const ids = [...new Set(commandIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      commandId: commands.id,
      principalId: commands.tenantActorPrincipalId,
      displayName: principals.displayName,
      scope: commands.scope,
    })
    .from(commands)
    .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
    .where(and(eq(commands.workspaceId, workspaceId), inArray(commands.id, ids)));
  return new Map(rows.map((row) => [row.commandId, toActor(row)]));
}

export interface LastEvent {
  actor: HistoryActor;
  occurredAt: Date;
}

/**
 * The latest event of these types on each entity, with its masked actor —
 * "who declared this work complete, and when". Entities with no such event are
 * absent from the map.
 */
export async function lastEvents(
  tx: TenantTx,
  workspaceId: string,
  entityType: string,
  entityIds: readonly string[],
  eventTypes: readonly string[],
): Promise<Map<string, LastEvent>> {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0 || eventTypes.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([auditEvents.entityId], {
      entityId: auditEvents.entityId,
      occurredAt: auditEvents.occurredAt,
      principalId: auditEvents.tenantActorPrincipalId,
      displayName: principals.displayName,
      scope: auditEvents.scope,
    })
    .from(auditEvents)
    .leftJoin(principals, eq(principals.id, auditEvents.tenantActorPrincipalId))
    .where(
      and(
        eq(auditEvents.workspaceId, workspaceId),
        eq(auditEvents.entityType, entityType),
        inArray(auditEvents.entityId, ids),
        inArray(auditEvents.eventType, [...eventTypes]),
      ),
    )
    .orderBy(auditEvents.entityId, desc(auditEvents.occurredAt), desc(auditEvents.id));
  return new Map(
    rows.map((row) => [row.entityId, { actor: toActor(row), occurredAt: row.occurredAt }]),
  );
}

/** `lastEvents`, keeping only the actor. */
export async function lastEventActors(
  tx: TenantTx,
  workspaceId: string,
  entityType: string,
  entityIds: readonly string[],
  eventTypes: readonly string[],
): Promise<Map<string, HistoryActor>> {
  const events = await lastEvents(tx, workspaceId, entityType, entityIds, eventTypes);
  return new Map([...events].map(([id, event]) => [id, event.actor]));
}

/**
 * Every tenant principal who ever acted on these entities with these event
 * types — the release's "vouchers", who may not also release. PLATFORM events
 * carry no tenant principal and contribute nothing.
 */
export async function eventPrincipalIds(
  tx: TenantTx,
  workspaceId: string,
  entityType: string,
  entityIds: readonly string[],
  eventTypes: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0 || eventTypes.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ principalId: auditEvents.tenantActorPrincipalId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, workspaceId),
        eq(auditEvents.entityType, entityType),
        inArray(auditEvents.entityId, ids),
        inArray(auditEvents.eventType, [...eventTypes]),
      ),
    );
  return new Set(rows.flatMap((row) => (row.principalId === null ? [] : [row.principalId])));
}
