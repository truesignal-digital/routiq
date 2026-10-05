import { and, eq } from "drizzle-orm";
import { commands } from "../db/schema.js";
import type { CommandContext, Tx } from "./dispatcher.js";

/** The member behind a command receipt: the maker of the record that command created. */
export async function receiptActor(
  tx: Tx,
  ctx: CommandContext,
  commandId: string,
): Promise<string | undefined> {
  const [receipt] = await tx
    .select({ initiatedByPrincipalId: commands.initiatedByPrincipalId })
    .from(commands)
    .where(and(eq(commands.workspaceId, ctx.workspaceId), eq(commands.id, commandId)))
    .limit(1);
  return receipt?.initiatedByPrincipalId;
}
