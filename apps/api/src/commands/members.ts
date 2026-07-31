import {
  addMemberPayload,
  deactivateMemberPayload,
  reactivateMemberPayload,
  resetMemberPinPayload,
  updateMemberRolePayload,
  type AddMemberPayload,
  type DeactivateMemberPayload,
  type MemberBranchScope,
  type ReactivateMemberPayload,
  type ResetMemberPinPayload,
  type UpdateMemberRolePayload,
} from "@routiq/contracts";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { hashPin } from "../auth/pin.js";
import { branches, credentials, memberships, principals, sessions } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandContext,
  type Tx,
} from "./dispatcher.js";
import { redactPin } from "./redaction.js";

/**
 * Day-2 member administration (spec: .scratch/user-management). A member is
 * three rows — principal, membership, credential — plus whatever sessions they
 * are holding, and each command here moves every one of them that matters in a
 * single transaction. Half-revoking a user is the failure mode worth designing
 * against: a membership switched off while a live session and an enabled
 * credential remain is an ex-employee who can still work.
 *
 * All five are ADMIN-only, CORE, workspace-scoped and never queued offline —
 * they are decisions about who the workspace trusts, not facts about the world.
 *
 * Optimistic concurrency is asked for where a lost update is possible and not
 * where it is not. `update-member-role` overwrites fields an admin read off the
 * screen, so it carries expectedVersion. Deactivate, reactivate and reset-pin
 * are absolute rather than relative — "revoke this person", not "change this
 * value to that one" — so a version conflict there would fail a request whose
 * outcome does not depend on the version. They still bump `row_version`, so a
 * role edit racing a deactivation is caught on the role edit's side.
 */

type MembershipRow = typeof memberships.$inferSelect;

/** The member's own principal id — the one stable handle across all three rows. */
async function loadMembership(
  tx: Tx,
  ctx: CommandContext,
  principalId: string,
): Promise<MembershipRow> {
  const [membership] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, ctx.workspaceId),
        eq(memberships.principalId, principalId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "member",
      referenceCode: principalId,
    });
  }
  return membership;
}

/** Branch ids are client-supplied, so each must be proven to live in this workspace. */
async function resolveBranchScope(
  tx: Tx,
  ctx: CommandContext,
  branchScope: MemberBranchScope,
): Promise<{ allBranches: boolean; branchIds: string[] }> {
  if (branchScope === "ALL") return { allBranches: true, branchIds: [] };

  const found = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(eq(branches.workspaceId, ctx.workspaceId), inArray(branches.id, branchScope)),
    );
  const known = new Set(found.map((row) => row.id));
  const missing = branchScope.filter((branchId) => !known.has(branchId));
  if (missing.length > 0) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "branch",
      missing,
    });
  }
  return { allBranches: false, branchIds: [...branchScope] };
}

function branchScopeOf(membership: MembershipRow): MemberBranchScope {
  return membership.allBranches ? "ALL" : membership.branchIds;
}

/**
 * §10's one structural rule about roles: a workspace always keeps at least one
 * active ADMIN, or nobody can ever administer it again. Checked by counting the
 * OTHER active admins, so the answer does not depend on whether the row being
 * changed has been written yet.
 */
async function assertAnotherActiveAdminRemains(
  tx: Tx,
  ctx: CommandContext,
  principalId: string,
): Promise<void> {
  const [others] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, ctx.workspaceId),
        eq(memberships.role, "ADMIN"),
        isNull(memberships.deactivatedAt),
        ne(memberships.principalId, principalId),
      ),
    );

  if ((others?.count ?? 0) === 0) {
    throw new CommandError(422, "LAST_ADMIN", { principalId });
  }
}

/**
 * Revocation has to reach the sessions already issued, or a 14-day token (§6)
 * outlives the decision that revoked it. Reset-pin deletes them for the same
 * reason in reverse: whoever knew the old PIN must not keep a session minted
 * with it.
 */
async function revokeSessions(
  tx: Tx,
  ctx: CommandContext,
  principalId: string,
): Promise<void> {
  await tx
    .delete(sessions)
    .where(
      and(eq(sessions.workspaceId, ctx.workspaceId), eq(sessions.principalId, principalId)),
    );
}

/** Compare-and-swap on the membership; the expected version rides in the predicate. */
async function updateMembershipAtVersion(
  tx: Tx,
  ctx: CommandContext,
  principalId: string,
  expectedVersion: number,
  changes: Partial<typeof memberships.$inferInsert>,
): Promise<MembershipRow> {
  const [updated] = await tx
    .update(memberships)
    .set({ ...changes, rowVersion: sql`${memberships.rowVersion} + 1` })
    .where(
      and(
        eq(memberships.workspaceId, ctx.workspaceId),
        eq(memberships.principalId, principalId),
        eq(memberships.rowVersion, expectedVersion),
      ),
    )
    .returning();

  if (updated) return updated;

  const current = await loadMembership(tx, ctx, principalId);
  throw new CommandError(409, "VERSION_CONFLICT", {
    expectedVersion,
    currentVersion: current.rowVersion,
  });
}

/** Same write without the version predicate, for the absolute state changes. */
async function bumpMembership(
  tx: Tx,
  ctx: CommandContext,
  principalId: string,
  changes: Partial<typeof memberships.$inferInsert>,
): Promise<MembershipRow> {
  const [updated] = await tx
    .update(memberships)
    .set({ ...changes, rowVersion: sql`${memberships.rowVersion} + 1` })
    .where(
      and(
        eq(memberships.workspaceId, ctx.workspaceId),
        eq(memberships.principalId, principalId),
      ),
    )
    .returning();
  if (!updated) throw new Error("memberships update returned no row");
  return updated;
}

registerCommand<AddMemberPayload>({
  name: "add-member",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: addMemberPayload,
  branchAuthorization: { kind: "workspace" },
  redactPayload: redactPin,

  async execute(tx, ctx, envelope, payload) {
    const scope = await resolveBranchScope(tx, ctx, payload.branchScope);

    /*
     * Checked before the insert so the ordinary collision answers with the code
     * the screen renders inline. The unique index still backs it for the race
     * two admins can lose to each other, which the dispatcher maps to the same
     * USERNAME_TAKEN — the guard is the index, this is the good error message.
     */
    const [taken] = await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(
        and(
          eq(credentials.workspaceId, ctx.workspaceId),
          eq(credentials.username, payload.username),
        ),
      )
      .limit(1);
    if (taken) {
      throw new CommandError(422, "USERNAME_TAKEN", { username: payload.username });
    }

    // Order is load-bearing: credentials carry a composite FK to memberships,
    // so the principal must be a member before it can hold a PIN.
    await tx.insert(principals).values({
      id: payload.principalId,
      principalType: "HUMAN",
      displayName: payload.displayName,
    });
    const [membership] = await tx
      .insert(memberships)
      .values({
        workspaceId: ctx.workspaceId,
        principalId: payload.principalId,
        role: payload.role,
        allBranches: scope.allBranches,
        branchIds: scope.branchIds,
      })
      .returning();
    if (!membership) throw new Error("memberships insert returned no row");

    await tx.insert(credentials).values({
      workspaceId: ctx.workspaceId,
      principalId: payload.principalId,
      username: payload.username,
      pinHash: await hashPin(payload.pin),
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "member.added",
      entityType: "membership",
      entityId: payload.principalId,
      // Username and display name only — a PIN or its hash never reaches the trail.
      afterState: {
        principalId: payload.principalId,
        displayName: payload.displayName,
        username: payload.username,
        role: payload.role,
        branchScope: payload.branchScope,
      },
    });

    return { recordId: payload.principalId, rowVersion: membership.rowVersion };
  },
});

registerCommand<UpdateMemberRolePayload>({
  name: "update-member-role",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: updateMemberRolePayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const expectedVersion = envelope.expectedVersion;
    if (expectedVersion === undefined) {
      throw new CommandError(400, "EXPECTED_VERSION_REQUIRED");
    }

    const before = await loadMembership(tx, ctx, payload.principalId);
    const nextRole = payload.role ?? before.role;

    // Only a live demotion can strand the workspace: an already-deactivated
    // membership is not one of the admins the invariant counts.
    if (before.role === "ADMIN" && nextRole !== "ADMIN" && before.deactivatedAt === null) {
      await assertAnotherActiveAdminRemains(tx, ctx, payload.principalId);
    }

    const scope =
      payload.branchScope === undefined
        ? undefined
        : await resolveBranchScope(tx, ctx, payload.branchScope);

    const after = await updateMembershipAtVersion(
      tx,
      ctx,
      payload.principalId,
      expectedVersion,
      {
        ...(payload.role === undefined ? {} : { role: payload.role }),
        ...(scope === undefined
          ? {}
          : { allBranches: scope.allBranches, branchIds: scope.branchIds }),
      },
    );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "member.role-updated",
      entityType: "membership",
      entityId: payload.principalId,
      beforeState: { role: before.role, branchScope: branchScopeOf(before) },
      afterState: { role: after.role, branchScope: branchScopeOf(after) },
      changedFields: [
        ...(payload.role === undefined ? [] : ["role"]),
        ...(payload.branchScope === undefined ? [] : ["branchScope"]),
      ],
    });

    return { recordId: payload.principalId, rowVersion: after.rowVersion };
  },
});

registerCommand<DeactivateMemberPayload>({
  name: "deactivate-member",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: deactivateMemberPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    // Ordered ahead of the last-admin count so the lone admin who clicks their
    // own row is told what they actually did, not that a rule about other
    // people was violated.
    if (payload.principalId === ctx.principalId) {
      throw new CommandError(422, "SELF_DEACTIVATION", { principalId: payload.principalId });
    }

    const before = await loadMembership(tx, ctx, payload.principalId);
    if (before.deactivatedAt !== null) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: "DEACTIVATED",
        to: "DEACTIVATED",
      });
    }
    /*
     * A backstop rather than a live path today: the caller is always an active
     * admin, so a target that is not them is never the last one. It stays
     * because the day this command gains a caller who is not the workspace's
     * own admin — a vendor support path, the AI principal of §7 — the self
     * guard above stops covering the invariant and this one has to.
     */
    if (before.role === "ADMIN") {
      await assertAnotherActiveAdminRemains(tx, ctx, payload.principalId);
    }

    const deactivatedAt = new Date();
    const after = await bumpMembership(tx, ctx, payload.principalId, { deactivatedAt });
    // Both doors: the membership stops authorizing, the credential stops
    // logging in. Neither alone is revocation.
    await tx
      .update(credentials)
      .set({ disabledAt: deactivatedAt })
      .where(
        and(
          eq(credentials.workspaceId, ctx.workspaceId),
          eq(credentials.principalId, payload.principalId),
        ),
      );
    await revokeSessions(tx, ctx, payload.principalId);

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "member.deactivated",
      entityType: "membership",
      entityId: payload.principalId,
      beforeState: { status: "ACTIVE", role: before.role },
      afterState: { status: "DEACTIVATED", role: after.role },
      changedFields: ["deactivatedAt"],
    });

    return { recordId: payload.principalId, rowVersion: after.rowVersion, recordStatus: "DEACTIVATED" };
  },
});

registerCommand<ReactivateMemberPayload>({
  name: "reactivate-member",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: reactivateMemberPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const before = await loadMembership(tx, ctx, payload.principalId);
    if (before.deactivatedAt === null) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: "ACTIVE",
        to: "ACTIVE",
      });
    }

    const after = await bumpMembership(tx, ctx, payload.principalId, {
      deactivatedAt: null,
    });
    await tx
      .update(credentials)
      .set({ disabledAt: null })
      .where(
        and(
          eq(credentials.workspaceId, ctx.workspaceId),
          eq(credentials.principalId, payload.principalId),
        ),
      );

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "member.reactivated",
      entityType: "membership",
      entityId: payload.principalId,
      beforeState: { status: "DEACTIVATED", role: before.role },
      afterState: { status: "ACTIVE", role: after.role },
      changedFields: ["deactivatedAt"],
    });

    return { recordId: payload.principalId, rowVersion: after.rowVersion, recordStatus: "ACTIVE" };
  },
});

registerCommand<ResetMemberPinPayload>({
  name: "reset-member-pin",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: resetMemberPinPayload,
  branchAuthorization: { kind: "workspace" },
  redactPayload: redactPin,

  async execute(tx, ctx, envelope, payload) {
    const membership = await loadMembership(tx, ctx, payload.principalId);

    const [credential] = await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(
        and(
          eq(credentials.workspaceId, ctx.workspaceId),
          eq(credentials.principalId, payload.principalId),
        ),
      )
      .limit(1);
    if (!credential) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "credential",
        referenceCode: payload.principalId,
      });
    }

    // Clearing the lockout counters here is what makes this the unlock verb
    // too: the admin a locked-out member calls has one thing to do, not two.
    await tx
      .update(credentials)
      .set({
        pinHash: await hashPin(payload.pin),
        failedAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(credentials.id, credential.id));
    await revokeSessions(tx, ctx, payload.principalId);

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "member.pin-reset",
      entityType: "membership",
      entityId: payload.principalId,
      // That a reset happened, never what it set. The PIN exists nowhere after
      // the dialog that entered it closes.
      afterState: { principalId: payload.principalId, sessionsRevoked: true },
      changedFields: ["pinHash", "failedAttempts", "lockedUntil"],
    });

    return { recordId: payload.principalId, rowVersion: membership.rowVersion };
  },
});
