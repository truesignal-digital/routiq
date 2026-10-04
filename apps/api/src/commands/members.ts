import {
  addMemberPayload,
  addMemberV1Payload,
  grantableRoles,
  MEMBER_ADMIN_ROLES,
  updateMemberRoleV1Payload,
  type BranchScope,
  type Role,
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
  type CommandDefinition,
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
 * All five are CORE, workspace-scoped and never queued offline — they are
 * decisions about who the workspace trusts, not facts about the world. Who may
 * run them (ADR-0009): DIRECTOR for every role in every branch; ADMIN only for
 * DRIVER, TECHNICIAN and CASHIER members inside the ADMIN's own branches,
 * checked on the member as they are and as the command would leave them.
 * Nobody changes their own role. `assertMayManage` is that rule.
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

/**
 * Advisory-lock class for member administration. Postgres advisory locks share
 * one global space, so the two-int form namespaces ours: a future lock picks a
 * different class and cannot collide with a workspace id that happens to hash
 * into the same bucket. First advisory lock in the codebase — follow this shape.
 */
export const MEMBER_ADMIN_LOCK_CLASS = 8241;

/**
 * Serializes member administration within one workspace, then re-reads the
 * caller's own membership now that it is serialized. Every member command opens
 * with this.
 *
 * The lock is what makes the last-admin invariant true rather than merely
 * checked. Under READ COMMITTED two admins demoting each other both see the
 * other still standing, both pass the guard, and both commit — leaving a
 * workspace nobody can administer. Counting rows cannot detect a sibling
 * transaction that has not committed yet, so the guard has to be serialized
 * rather than made cleverer. The lock is transaction-scoped: it releases on
 * commit or rollback with nothing to unwind.
 *
 * The re-read closes the other half. `requireAuth` resolved the caller's role
 * before this transaction opened, and a concurrent command may have demoted or
 * deactivated them in between — the window in which a stale ADMIN context could
 * still perform exactly the powers being taken away from it.
 */
export async function beginMemberAdministration(
  tx: Tx,
  ctx: CommandContext,
): Promise<MemberAdministrator> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${MEMBER_ADMIN_LOCK_CLASS}, hashtext(${ctx.workspaceId}))`,
  );

  const [actor] = await tx
    .select({
      role: memberships.role,
      allBranches: memberships.allBranches,
      branchIds: memberships.branchIds,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, ctx.workspaceId),
        eq(memberships.principalId, ctx.principalId),
      ),
    )
    .limit(1);

  if (
    !actor ||
    actor.deactivatedAt !== null ||
    !(MEMBER_ADMIN_ROLES as readonly Role[]).includes(actor.role)
  ) {
    throw new CommandError(403, "ROLE_FORBIDDEN", { reason: "actor-no-longer-admin" });
  }
  return {
    role: actor.role,
    branchScope: actor.role === "DIRECTOR" || actor.allBranches ? "ALL" : actor.branchIds,
  };
}

/** The caller as `beginMemberAdministration` re-read them under the lock. */
interface MemberAdministrator {
  role: Role;
  branchScope: BranchScope;
}

/**
 * ADR-0009's app-access rule, applied to one side of a member: as they stand,
 * or as the command would leave them. The role must be one the actor may grant,
 * and every branch the member reaches must be one the actor reaches — an ADMIN
 * scoped to Bafoussam cannot touch a member who also works in Douala, nor hand
 * out "all branches".
 */
function assertMayManage(
  actor: MemberAdministrator,
  member: { role: Role; branchScope: MemberBranchScope },
): void {
  if (!grantableRoles(actor.role).includes(member.role)) {
    throw new CommandError(403, "MEMBER_ROLE_NOT_GRANTABLE", {
      actorRole: actor.role,
      memberRole: member.role,
    });
  }
  if (actor.branchScope === "ALL") return;
  const reach = actor.branchScope;
  const outside =
    member.branchScope === "ALL"
      ? ["ALL"]
      : member.branchScope.filter((branchId) => !reach.includes(branchId));
  if (outside.length > 0) {
    throw new CommandError(403, "MEMBER_BRANCH_OUT_OF_SCOPE", { outside });
  }
}

/** DIRECTOR always covers every branch (ADR-0009), so no other scope is storable. */
function assertDirectorScope(role: Role, branchScope: MemberBranchScope): void {
  if (role === "DIRECTOR" && branchScope !== "ALL") {
    throw new CommandError(422, "DIRECTOR_REQUIRES_ALL_BRANCHES");
  }
}

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
 * §10's one structural rule about roles: a workspace that has a DIRECTOR keeps
 * at least one active, or nobody can manage its settings and senior access
 * again. Checked by counting the OTHER active directors, so the answer does not
 * depend on whether the row being changed has been written yet. A workspace
 * migrated from the old roles starts with none; its first is appointed by the
 * vendor (`appoint-director`).
 */
async function assertAnotherActiveDirectorRemains(
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
        eq(memberships.role, "DIRECTOR"),
        isNull(memberships.deactivatedAt),
        ne(memberships.principalId, principalId),
      ),
    );

  if ((others?.count ?? 0) === 0) {
    throw new CommandError(422, "LAST_DIRECTOR", { principalId });
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

const addMember: Omit<CommandDefinition<AddMemberPayload>, "version" | "payloadSchema"> = {
  name: "add-member",
  module: "CORE",
  allowedRoles: MEMBER_ADMIN_ROLES,
  branchAuthorization: { kind: "workspace" },
  redactPayload: redactPin,

  async execute(tx, ctx, envelope, payload) {
    const actor = await beginMemberAdministration(tx, ctx);
    assertMayManage(actor, payload);
    assertDirectorScope(payload.role, payload.branchScope);
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
};

registerCommand<AddMemberPayload>({ ...addMember, version: 2, payloadSchema: addMemberPayload });
/** v1 shipped with the pre-ADR-0009 roles; its payload maps each to the role it became. */
registerCommand<AddMemberPayload>({ ...addMember, version: 1, payloadSchema: addMemberV1Payload });

const updateMemberRole: Omit<
  CommandDefinition<UpdateMemberRolePayload>,
  "version" | "payloadSchema"
> = {
  name: "update-member-role",
  module: "CORE",
  allowedRoles: MEMBER_ADMIN_ROLES,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const actor = await beginMemberAdministration(tx, ctx);
    const expectedVersion = envelope.expectedVersion;
    if (expectedVersion === undefined) {
      throw new CommandError(400, "EXPECTED_VERSION_REQUIRED");
    }
    // Branches too, not just the role: an ADMIN widening their own reach is
    // the same escalation as promoting themselves.
    if (payload.principalId === ctx.principalId) {
      throw new CommandError(422, "SELF_ROLE_CHANGE", { principalId: payload.principalId });
    }

    const before = await loadMembership(tx, ctx, payload.principalId);
    const nextRole = payload.role ?? before.role;
    const nextScope = payload.branchScope ?? branchScopeOf(before);
    assertMayManage(actor, { role: before.role, branchScope: branchScopeOf(before) });
    assertMayManage(actor, { role: nextRole, branchScope: nextScope });
    assertDirectorScope(nextRole, nextScope);

    // Only a live demotion can strand the workspace: an already-deactivated
    // membership is not one of the directors the invariant counts.
    if (before.role === "DIRECTOR" && nextRole !== "DIRECTOR" && before.deactivatedAt === null) {
      await assertAnotherActiveDirectorRemains(tx, ctx, payload.principalId);
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
};

registerCommand<UpdateMemberRolePayload>({
  ...updateMemberRole,
  version: 2,
  payloadSchema: updateMemberRolePayload,
});
/** v1 shipped with the pre-ADR-0009 roles; its payload maps each to the role it became. */
registerCommand<UpdateMemberRolePayload>({
  ...updateMemberRole,
  version: 1,
  payloadSchema: updateMemberRoleV1Payload,
});

registerCommand<DeactivateMemberPayload>({
  name: "deactivate-member",
  version: 1,
  module: "CORE",
  allowedRoles: MEMBER_ADMIN_ROLES,
  payloadSchema: deactivateMemberPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const actor = await beginMemberAdministration(tx, ctx);

    // Ordered ahead of the last-director count so the lone admin who clicks their
    // own row is told what they actually did, not that a rule about other
    // people was violated.
    if (payload.principalId === ctx.principalId) {
      throw new CommandError(422, "SELF_DEACTIVATION", { principalId: payload.principalId });
    }

    const before = await loadMembership(tx, ctx, payload.principalId);
    assertMayManage(actor, { role: before.role, branchScope: branchScopeOf(before) });
    if (before.deactivatedAt !== null) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", {
        from: "DEACTIVATED",
        to: "DEACTIVATED",
      });
    }
    /*
     * A backstop rather than a live path today: only a DIRECTOR may deactivate
     * a DIRECTOR, and never themselves, so a target that is not them is never
     * the last one. It stays because the day this command gains a caller who
     * is not the workspace's own director — a vendor support path, the AI
     * principal of §7 — the self guard above stops covering the invariant and
     * this one has to.
     */
    if (before.role === "DIRECTOR") {
      await assertAnotherActiveDirectorRemains(tx, ctx, payload.principalId);
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
  allowedRoles: MEMBER_ADMIN_ROLES,
  payloadSchema: reactivateMemberPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const actor = await beginMemberAdministration(tx, ctx);

    const before = await loadMembership(tx, ctx, payload.principalId);
    assertMayManage(actor, { role: before.role, branchScope: branchScopeOf(before) });
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
  allowedRoles: MEMBER_ADMIN_ROLES,
  payloadSchema: resetMemberPinPayload,
  branchAuthorization: { kind: "workspace" },
  redactPayload: redactPin,

  async execute(tx, ctx, envelope, payload) {
    const actor = await beginMemberAdministration(tx, ctx);
    const membership = await loadMembership(tx, ctx, payload.principalId);
    assertMayManage(actor, { role: membership.role, branchScope: branchScopeOf(membership) });

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
