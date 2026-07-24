import type { CommandEnvelope } from "@routiq/contracts";
import { and, eq, sql } from "drizzle-orm";
import { assets } from "../db/schema.js";
import { CommandError, type CommandContext, type Tx } from "./dispatcher.js";

export type AssetVersionedChanges = Omit<
  Partial<typeof assets.$inferInsert>,
  "id" | "workspaceId" | "rowVersion" | "createdByCommandId"
>;

/**
 * Compare-and-swap for mutable asset state. The expected version participates
 * in the UPDATE predicate, so concurrent writers cannot both commit.
 */
export async function updateAssetAtVersion(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  assetId: string,
  changes: AssetVersionedChanges,
): Promise<typeof assets.$inferSelect> {
  const expectedVersion = envelope.expectedVersion;
  if (expectedVersion === undefined) {
    throw new CommandError(400, "EXPECTED_VERSION_REQUIRED");
  }

  const [updated] = await tx
    .update(assets)
    .set({
      ...changes,
      rowVersion: sql`${assets.rowVersion} + 1`,
    })
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, assetId),
        eq(assets.rowVersion, expectedVersion),
      ),
    )
    .returning();

  if (updated) return updated;

  const [current] = await tx
    .select({ rowVersion: assets.rowVersion })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        eq(assets.id, assetId),
      ),
    );
  if (!current) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "asset",
      referenceCode: assetId,
    });
  }
  throw new CommandError(409, "VERSION_CONFLICT", {
    expectedVersion,
    currentVersion: current.rowVersion,
  });
}
