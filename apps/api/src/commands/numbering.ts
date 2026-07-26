import { sql } from "drizzle-orm";
import { numberCounters } from "../db/schema.js";
import type { CommandContext, Tx } from "./dispatcher.js";

/**
 * Concurrency-safe human-readable numbering: the upsert takes a row lock, so
 * two entries in the same scope can never draw the same sequence. Scoped
 * per branch per year — `{branchCode}-{year}-{seq5}` (§12 Q4 numbering scheme,
 * pilot default).
 */
export async function nextEntryNumber(
  tx: Tx,
  ctx: CommandContext,
  branch: { id: string; code: string },
  economicDate: string,
): Promise<string> {
  const year = economicDate.slice(0, 4);
  const scope = `ENTRY:${branch.id}:${year}`;
  const [row] = await tx
    .insert(numberCounters)
    .values({ workspaceId: ctx.workspaceId, scope, nextValue: 2n })
    .onConflictDoUpdate({
      target: [numberCounters.workspaceId, numberCounters.scope],
      set: { nextValue: sql`${numberCounters.nextValue} + 1` },
    })
    .returning({ nextValue: numberCounters.nextValue });
  if (!row) throw new Error(`counter upsert returned nothing: ${scope}`);
  const seq = row.nextValue - 1n;
  return `${branch.code}-${year}-${String(seq).padStart(5, "0")}`;
}
