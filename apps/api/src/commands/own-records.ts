import type { CommandOrigin, Role } from "@routiq/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { activityPeople, auditEvents, commands, persons } from "../db/schema.js";
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

/**
 * A driver's own trip (ADR-0012 §3): one they recorded, one they are the
 * planned driver of, or one they are on as a DRIVER crew member. A trip the
 * office booked has the office as its author, and without the last two the
 * driver could not start, close or swap the vehicle on it.
 *
 * An offline replay passes when the caller was the planned driver at any
 * point, as the trip's audit events show (§5): a reassignment made while the
 * driver was on the road must not turn their real trip into OWN_RECORDS_ONLY.
 */
export async function assertOwnTrip(
  tx: Tx,
  ctx: CommandContext,
  ownOnly: readonly Role[],
  trip: { id: string; createdByCommandId: string; plannedDriverPersonId: string | null },
  origin?: CommandOrigin,
): Promise<void> {
  if (!ownOnly.includes(ctx.role)) return;
  if (await isAuthor(tx, ctx, trip.createdByCommandId)) return;

  const callerPersonIds = (
    await tx
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.workspaceId, ctx.workspaceId), eq(persons.membershipId, ctx.membershipId)))
  ).map((row) => row.id);
  if (callerPersonIds.length > 0) {
    if (trip.plannedDriverPersonId !== null && callerPersonIds.includes(trip.plannedDriverPersonId)) {
      return;
    }
    const [crewDriver] = await tx
      .select({ id: activityPeople.id })
      .from(activityPeople)
      .where(
        and(
          eq(activityPeople.workspaceId, ctx.workspaceId),
          eq(activityPeople.activityId, trip.id),
          eq(activityPeople.role, "DRIVER"),
          inArray(activityPeople.personId, callerPersonIds),
        ),
      )
      .limit(1);
    if (crewDriver) return;

    if (origin === "OFFLINE_SYNC") {
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
