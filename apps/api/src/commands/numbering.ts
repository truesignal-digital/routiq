import { sql } from "drizzle-orm";
import { numberCounters } from "../db/schema.js";
import type { CommandContext, Tx } from "./dispatcher.js";

/**
 * Concurrency-safe sequence draw: the upsert takes a row lock, so two callers in
 * the same scope can never get the same number. The increment is an ordinary
 * UPDATE inside the command transaction, so a rolled-back command rolls the
 * counter back too — retries stay gap-free, at the cost of serializing
 * concurrent draws on one row per scope. That is the right trade at pilot
 * volume; do not "optimize" it into a sequence, which would reintroduce gaps.
 */
async function nextScopedSequence(
  tx: Tx,
  ctx: CommandContext,
  scope: string,
): Promise<bigint> {
  const [row] = await tx
    .insert(numberCounters)
    .values({ workspaceId: ctx.workspaceId, scope, nextValue: 2n })
    .onConflictDoUpdate({
      target: [numberCounters.workspaceId, numberCounters.scope],
      set: { nextValue: sql`${numberCounters.nextValue} + 1` },
    })
    .returning({ nextValue: numberCounters.nextValue });
  if (!row) throw new Error(`counter upsert returned nothing: ${scope}`);
  return row.nextValue - 1n;
}

/**
 * `{branchCode}-{year}-{seq5}` — the §12 Q4 pilot default, deliberately kept in
 * one place. Q4 is still open, and §6 wants devices to hold pre-allocated
 * branch-prefixed ranges so a clerk can write a number on paper while offline;
 * when that lands, this function and a range allocator are the only things that
 * change. Activities additionally carry `client_reference` for the number
 * actually written on the waybill.
 */
function formatNumber(branchCode: string, year: string, seq: bigint): string {
  return `${branchCode}-${year}-${String(seq).padStart(5, "0")}`;
}

export async function nextEntryNumber(
  tx: Tx,
  ctx: CommandContext,
  branch: { id: string; code: string },
  economicDate: string,
): Promise<string> {
  const year = economicDate.slice(0, 4);
  const seq = await nextScopedSequence(tx, ctx, `ENTRY:${branch.id}:${year}`);
  return formatNumber(branch.code, year, seq);
}

export async function nextActivityNumber(
  tx: Tx,
  ctx: CommandContext,
  branch: { id: string; code: string },
  businessDate: string,
): Promise<string> {
  const year = businessDate.slice(0, 4);
  const seq = await nextScopedSequence(tx, ctx, `ACTIVITY:${branch.id}:${year}`);
  return formatNumber(branch.code, year, seq);
}

/**
 * Work orders and problems are numbered per workspace, without branch or year
 * (#608): a plain integer the client prefixes in its own words ("OT-0007",
 * "WO-0007"). Same counter table and lock as the entry numbers, so the draw is
 * gap-free and rolls back with a refused command.
 */
export async function nextWorkOrderNumber(tx: Tx, ctx: CommandContext): Promise<number> {
  return Number(await nextScopedSequence(tx, ctx, "WORK_ORDER"));
}

export async function nextIssueNumber(tx: Tx, ctx: CommandContext): Promise<number> {
  return Number(await nextScopedSequence(tx, ctx, "ISSUE"));
}
