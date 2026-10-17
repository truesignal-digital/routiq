import type { CommandOrigin, Role } from "@routiq/contracts";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AuthContext } from "../auth/types.js";
import { activities, activityPeople, auditEvents, commands, persons } from "../db/schema.js";
import { CommandError, type CommandContext, type Tx } from "./dispatcher.js";

/**
 * The "own" cells of docs/reference/roles-and-access.md: some roles may act
 * only on records they recorded themselves. A record's author is whoever
 * initiated the command that created it (`created_by_command_id`), the same
 * reading `update-pending-entry` uses for NOT_ENTRY_AUTHOR. Other roles pass.
 */
export async function assertOwnRecord(
  tx: Tx,
  ctx: CommandContext,
  ownOnly: readonly Role[],
  record: { entityType: string; id: string; createdByCommandId: string },
): Promise<void> {
  if (!ownOnly.includes(ctx.role)) return;
  if (await isAuthor(tx, ctx, record.createdByCommandId)) return;
  throw ownRecordsOnly(ctx, record.entityType, record.id);
}

/** The `activities` columns the own-trip rule reads, on the table or an alias of it. */
interface TripColumns {
  id: AnyPgColumn;
  workspaceId: AnyPgColumn;
  createdByCommandId: AnyPgColumn;
  plannedDriverPersonId: AnyPgColumn;
}

/**
 * A driver's own trip (ADR-0012 §3), as a condition on a trip row: one they
 * recorded, one they are the planned driver of, or one they are on as a DRIVER
 * crew member. The ONE definition: the commands' `assertOwnTrip` and every
 * read that narrows trips to the caller's own (`readableTripSql`) use it, so
 * a driver never sees a trip they cannot act on, or acts on one they cannot see.
 *
 * "Them" is the caller's principal for authorship and the caller's Person
 * (`persons.membership_id`) for the plan and the crew.
 */
export function ownTripSql(
  caller: Pick<AuthContext, "principalId" | "membershipId">,
  trip: TripColumns = activities,
): SQL {
  return sql`(
    exists (
      select 1 from ${commands}
      where ${commands.workspaceId} = ${trip.workspaceId}
        and ${commands.id} = ${trip.createdByCommandId}
        and ${commands.initiatedByPrincipalId} = ${caller.principalId}
    )
    or exists (
      select 1 from ${persons}
      where ${persons.workspaceId} = ${trip.workspaceId}
        and ${persons.membershipId} = ${caller.membershipId}
        and (
          ${persons.id} = ${trip.plannedDriverPersonId}
          or exists (
            select 1 from ${activityPeople}
            where ${activityPeople.workspaceId} = ${trip.workspaceId}
              and ${activityPeople.activityId} = ${trip.id}
              and ${activityPeople.role} = 'DRIVER'
              and ${activityPeople.personId} = ${persons.id}
          )
        )
    )
  )`;
}

/**
 * The command side of `ownTripSql`. A trip the office booked has the office as
 * its author, and without the plan and the crew the driver could not start,
 * close or swap the vehicle on it.
 *
 * An offline replay passes when the caller was the planned driver at any
 * point, as the trip's audit events show (§5): a reassignment made while the
 * driver was on the road must not turn their real trip into OWN_RECORDS_ONLY.
 */
export async function assertOwnTrip(
  tx: Tx,
  ctx: CommandContext,
  ownOnly: readonly Role[],
  trip: { id: string },
  origin?: CommandOrigin,
): Promise<void> {
  if (!ownOnly.includes(ctx.role)) return;
  const [own] = await tx
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.id, trip.id), ownTripSql(ctx)),
    )
    .limit(1);
  if (own) return;

  if (origin === "OFFLINE_SYNC") {
    const callerPersonIds = (
      await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.workspaceId, ctx.workspaceId), eq(persons.membershipId, ctx.membershipId)))
    ).map((row) => row.id);
    if (callerPersonIds.length > 0) {
      const [wasPlanned] = await tx
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, ctx.workspaceId),
            eq(auditEvents.entityType, "activity"),
            eq(auditEvents.entityId, trip.id),
            inArray(sql<string>`${auditEvents.afterState} ->> 'plannedDriverPersonId'`, callerPersonIds),
          ),
        )
        .limit(1);
      if (wasPlanned) return;
    }
  }

  throw ownRecordsOnly(ctx, "activity", trip.id);
}

async function isAuthor(tx: Tx, ctx: CommandContext, createdByCommandId: string): Promise<boolean> {
  const [receipt] = await tx
    .select({ initiatedByPrincipalId: commands.initiatedByPrincipalId })
    .from(commands)
    .where(and(eq(commands.workspaceId, ctx.workspaceId), eq(commands.id, createdByCommandId)))
    .limit(1);
  return receipt?.initiatedByPrincipalId === ctx.principalId;
}

function ownRecordsOnly(ctx: CommandContext, entityType: string, entityId: string): CommandError {
  return new CommandError(403, "OWN_RECORDS_ONLY", { entityType, entityId, role: ctx.role });
}
