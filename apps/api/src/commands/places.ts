import { and, eq } from "drizzle-orm";
import { places } from "../db/schema.js";
import type { CommandContext, Tx } from "./dispatcher.js";

/** Origins and destinations as clerks type them: "Douala", " douala ", "DOUALA". */
export function normalizePlaceName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface PlaceRef {
  /** Client-generated id, used only if this name is new to the workspace. */
  placeId: string;
  name: string;
}

async function findPlace(
  tx: Tx,
  ctx: CommandContext,
  normalized: string,
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .select({ id: places.id })
    .from(places)
    .where(
      and(eq(places.workspaceId, ctx.workspaceId), eq(places.normalizedName, normalized)),
    )
    .limit(1);
  return row;
}

/**
 * Places have no command of their own (§3.1 calls for a *minimal* table, and an
 * admin screen for depot names is ceremony nobody asked for). The vocabulary
 * grows by use: the first leg that names "Meiganga" registers it.
 *
 * Replay-safe despite the client-generated id: resolution is deterministic on
 * the normalized name, so a replayed envelope lands on the same row even when
 * its proposed id lost the race. Nothing references a place by client id.
 */
export async function resolveOrCreatePlace(
  tx: Tx,
  ctx: CommandContext,
  ref: PlaceRef,
  createdByCommandId: string,
): Promise<string> {
  const normalized = normalizePlaceName(ref.name);
  const existing = await findPlace(tx, ctx, normalized);
  if (existing) return existing.id;

  await tx
    .insert(places)
    .values({
      id: ref.placeId,
      workspaceId: ctx.workspaceId,
      name: ref.name.trim(),
      normalizedName: normalized,
      createdByCommandId,
    })
    .onConflictDoNothing();

  const created = await findPlace(tx, ctx, normalized);
  if (!created) throw new Error(`place upsert failed: ${normalized}`);
  return created.id;
}
