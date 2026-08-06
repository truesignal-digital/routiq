import {
  renameBranchPayload,
  setBranchStatusPayload,
  type CommandEnvelope,
  type RenameBranchPayload,
  type SetBranchStatusPayload,
} from "@routiq/contracts";
import { and, eq, ne, sql } from "drizzle-orm";
import { branches } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";

/**
 * Day-2 branch administration (spec: .scratch/multi-branch). `create-branch`
 * made branches ordinary mutable business rows; these two are what an admin does
 * to them afterwards.
 *
 * Two rules shape the pair. A branch `code` is immutable — it is embedded in
 * every record number the branch has ever printed (`DLA-2026-00004`) — so rename
 * touches `name` and nothing else. And a branch is never deleted: records keep
 * pointing at it forever, so retiring one flips `active`, which stops NEW writes
 * targeting it (`branchIdsByCode`, 422 BRANCH_INACTIVE) while leaving every
 * existing record, report and asset transfer OUT of it working.
 */

type BranchRow = typeof branches.$inferSelect;

function branchState(row: BranchRow): Record<string, unknown> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    code: row.code,
    name: row.name,
    timezone: row.timezone,
    active: row.active,
    createdByCommandId: row.createdByCommandId,
    rowVersion: row.rowVersion,
  };
}

/**
 * Advisory-lock class for branch administration — distinct from
 * `MEMBER_ADMIN_LOCK_CLASS` (members.ts) because Postgres advisory locks share
 * one global space and two unrelated invariants must not serialize against each
 * other, nor collide on a workspace id that hashes into the same bucket.
 */
const BRANCH_ADMIN_LOCK_CLASS = 8242;

/**
 * Serializes branch status changes within one workspace so the last-active-
 * branch count is true rather than merely checked. Under READ COMMITTED two
 * admins deactivating the last two branches each see the other still active,
 * both pass the guard, and both commit — leaving a workspace that can accept no
 * new record anywhere. Counting rows cannot see an uncommitted sibling, so the
 * guard has to be serialized. Transaction-scoped: it releases on commit or
 * rollback with nothing to unwind.
 *
 * Rename does not take it. It changes a label no invariant counts.
 */
async function beginBranchAdministration(tx: Tx, ctx: CommandContext): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${BRANCH_ADMIN_LOCK_CLASS}, hashtext(${ctx.workspaceId}))`,
  );
}

async function requireBranch(
  tx: Tx,
  ctx: CommandContext,
  branchId: string,
): Promise<BranchRow> {
  const [row] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.workspaceId, ctx.workspaceId), eq(branches.id, branchId)))
    .limit(1);
  if (!row) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "branch",
      referenceId: branchId,
    });
  }
  return row;
}

/**
 * Compare-and-swap for mutable branch state, mirroring `updateAssetAtVersion`:
 * the expected version rides in the UPDATE predicate, so two concurrent writers
 * cannot both commit and the loser is told which version it lost to.
 */
async function updateBranchAtVersion(
  tx: Tx,
  ctx: CommandContext,
  branchId: string,
  expectedVersion: number,
  changes: Partial<typeof branches.$inferInsert>,
): Promise<BranchRow> {
  const [updated] = await tx
    .update(branches)
    .set({ ...changes, rowVersion: sql`${branches.rowVersion} + 1` })
    .where(
      and(
        eq(branches.workspaceId, ctx.workspaceId),
        eq(branches.id, branchId),
        eq(branches.rowVersion, expectedVersion),
      ),
    )
    .returning();

  if (updated) return updated;

  const current = await requireBranch(tx, ctx, branchId);
  throw new CommandError(409, "VERSION_CONFLICT", {
    expectedVersion,
    currentVersion: current.rowVersion,
  });
}

/** The same write without the version predicate, for the absolute state flip. */
async function bumpBranch(
  tx: Tx,
  ctx: CommandContext,
  branchId: string,
  changes: Partial<typeof branches.$inferInsert>,
): Promise<BranchRow> {
  const [updated] = await tx
    .update(branches)
    .set({ ...changes, rowVersion: sql`${branches.rowVersion} + 1` })
    .where(and(eq(branches.workspaceId, ctx.workspaceId), eq(branches.id, branchId)))
    .returning();
  if (!updated) throw new Error("branches update returned no row");
  return updated;
}

function requireExpectedVersion(envelope: CommandEnvelope): number {
  if (envelope.expectedVersion === undefined) {
    throw new CommandError(400, "EXPECTED_VERSION_REQUIRED");
  }
  return envelope.expectedVersion;
}

/** The workspace keeps at least one active branch, or it can accept no new record at all. */
async function assertAnotherActiveBranchRemains(
  tx: Tx,
  ctx: CommandContext,
  branchId: string,
): Promise<void> {
  const [others] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(branches)
    .where(
      and(
        eq(branches.workspaceId, ctx.workspaceId),
        eq(branches.active, true),
        ne(branches.id, branchId),
      ),
    );

  if ((others?.count ?? 0) === 0) {
    throw new CommandError(409, "LAST_BRANCH", { branchId });
  }
}

const renameBranch: CommandDefinition<RenameBranchPayload> = {
  name: "rename-branch",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: renameBranchPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    // Rename overwrites free text a concurrent admin may have just written, so
    // expectedVersion is mandatory here — same reasoning as relabel-category.
    const expectedVersion = requireExpectedVersion(envelope);
    const before = await requireBranch(tx, ctx, payload.branchId);
    const after = await updateBranchAtVersion(tx, ctx, before.id, expectedVersion, {
      name: payload.name,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "branch.renamed",
      entityType: "branch",
      entityId: after.id,
      beforeState: branchState(before),
      afterState: branchState(after),
      changedFields: ["name", "rowVersion"],
    });

    return { recordId: after.id, rowVersion: after.rowVersion };
  },
};

const setBranchStatus: CommandDefinition<SetBranchStatusPayload> = {
  name: "set-branch-status",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: setBranchStatusPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    await beginBranchAdministration(tx, ctx);
    // Read under the lock: the picture the guards below count against must be
    // the serialized one, not the one this request opened with.
    const before = await requireBranch(tx, ctx, payload.branchId);

    /*
     * A flip that would change nothing is refused rather than swallowed
     * (PRESET_ALREADY_SET precedent): the admin is acting on a list fetched
     * earlier, and "already in that state" is information they need. The client
     * refetches.
     */
    if (before.active === payload.active) {
      throw new CommandError(409, "BRANCH_STATUS_ALREADY_SET", {
        branchId: before.id,
        active: payload.active,
      });
    }

    if (!payload.active) {
      await assertAnotherActiveBranchRemains(tx, ctx, before.id);
    }

    /*
     * Optional here, honored when sent — category.ts's state flips and the
     * absolute member commands read the same way. The no-op refusal above
     * already catches the stale client this would otherwise have to catch, and
     * the target state is absolute ("close this branch") rather than relative to
     * a value the caller read off a screen. Sending no version must therefore
     * not be able to lose to a concurrent rename, which is why the unversioned
     * path is a plain bump rather than a compare-and-swap against what this
     * transaction happened to read.
     */
    const changes = { active: payload.active };
    const after =
      envelope.expectedVersion === undefined
        ? await bumpBranch(tx, ctx, before.id, changes)
        : await updateBranchAtVersion(
            tx,
            ctx,
            before.id,
            envelope.expectedVersion,
            changes,
          );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: payload.active ? "branch.reactivated" : "branch.deactivated",
      entityType: "branch",
      entityId: after.id,
      beforeState: branchState(before),
      afterState: branchState(after),
      changedFields: ["active", "rowVersion"],
    });

    return {
      recordId: after.id,
      rowVersion: after.rowVersion,
      recordStatus: after.active ? "ACTIVE" : "INACTIVE",
    };
  },
};

registerCommand(renameBranch);
registerCommand(setBranchStatus);
