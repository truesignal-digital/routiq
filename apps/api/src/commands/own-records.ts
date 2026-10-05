import type { Role } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { commands } from "../db/schema.js";
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

  const [receipt] = await tx
    .select({ initiatedByPrincipalId: commands.initiatedByPrincipalId })
    .from(commands)
    .where(
      and(
        eq(commands.workspaceId, ctx.workspaceId),
        eq(commands.id, record.createdByCommandId),
      ),
    )
    .limit(1);

  if (receipt?.initiatedByPrincipalId !== ctx.principalId) {
    throw new CommandError(403, "OWN_RECORDS_ONLY", {
      entityType: record.entityType,
      entityId: record.id,
      role: ctx.role,
    });
  }
}
