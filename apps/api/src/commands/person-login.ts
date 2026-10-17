import {
  linkPersonLoginPayload,
  MEMBER_ADMIN_ROLES,
  unlinkPersonLoginPayload,
  type CommandEnvelope,
  type LinkPersonLoginPayload,
  type UnlinkPersonLoginPayload,
} from "@routiq/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { memberships, personLogins, persons } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandContext,
  type Tx,
} from "./dispatcher.js";
import { assertMayManage, beginMemberAdministration, branchScopeOf } from "./members.js";

/**
 * Person ↔ login (#569, ADR-0010). A Person exists whether or not they ever
 * sign in, and a login exists whether or not it belongs to someone who drives.
 * The link is what makes a driver's planned and crewed trips their own
 * (`ownTripSql`).
 *
 * `persons.membership_id` holds the current link and `person_logins` every
 * link: relinking ends the open row and opens another, unlinking ends it.
 * Nothing is rewritten. These two commands are the only writers of both.
 *
 * Who may run them is who may give app access: Direction, and the
 * Administrateur for the logins it may manage (`assertMayManage`) and the
 * people of its own branches. Both run under the member-administration lock,
 * so a link cannot race a role change on the same login.
 */

type PersonState = {
  id: string;
  branchId: string;
  membershipId: string | null;
  active: boolean;
  rowVersion: number;
};

type MembershipState = typeof memberships.$inferSelect;

async function loadPerson(tx: Tx, ctx: CommandContext, personId: string): Promise<PersonState> {
  const [person] = await tx
    .select({
      id: persons.id,
      branchId: persons.branchId,
      membershipId: persons.membershipId,
      active: persons.active,
      rowVersion: persons.rowVersion,
    })
    .from(persons)
    .where(and(eq(persons.workspaceId, ctx.workspaceId), eq(persons.id, personId)))
    .limit(1);
  if (!person) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "person",
      referenceCode: personId,
    });
  }
  return person;
}

/** The person's home branch, for the dispatcher's branch-scope check. */
async function personBranch(tx: Tx, ctx: CommandContext, personId: string): Promise<string[]> {
  const [row] = await tx
    .select({ branchId: persons.branchId })
    .from(persons)
    .where(and(eq(persons.workspaceId, ctx.workspaceId), eq(persons.id, personId)))
    .limit(1);
  // A missing person is answered by `execute` as REFERENCE_NOT_FOUND.
  return row ? [row.branchId] : [];
}

async function membershipBy(
  tx: Tx,
  ctx: CommandContext,
  column: typeof memberships.principalId | typeof memberships.id,
  value: string,
): Promise<MembershipState | undefined> {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(column, value)))
    .limit(1);
  return row;
}

/** The login a client named by principal id; a deactivated one cannot sign in, so it cannot be given. */
async function loginToLink(tx: Tx, ctx: CommandContext, principalId: string): Promise<MembershipState> {
  const membership = await membershipBy(tx, ctx, memberships.principalId, principalId);
  if (!membership) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "member",
      referenceCode: principalId,
    });
  }
  if (membership.deactivatedAt !== null) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "member",
      referenceCode: principalId,
      reason: "deactivated",
    });
  }
  return membership;
}

/** The login a person is linked to now. The composite FK guarantees it exists. */
async function currentLogin(tx: Tx, ctx: CommandContext, membershipId: string): Promise<MembershipState> {
  const membership = await membershipBy(tx, ctx, memberships.id, membershipId);
  if (!membership) throw new Error("persons.membership_id names no membership");
  return membership;
}

function requireExpectedVersion(envelope: CommandEnvelope): number {
  if (envelope.expectedVersion === undefined) {
    throw new CommandError(400, "EXPECTED_VERSION_REQUIRED");
  }
  return envelope.expectedVersion;
}

/** Compare-and-swap on the person row: the version rides in the UPDATE predicate. */
async function setCurrentLogin(
  tx: Tx,
  ctx: CommandContext,
  personId: string,
  membershipId: string | null,
  expectedVersion: number,
): Promise<number> {
  const [updated] = await tx
    .update(persons)
    .set({ membershipId, rowVersion: sql`${persons.rowVersion} + 1` })
    .where(
      and(
        eq(persons.workspaceId, ctx.workspaceId),
        eq(persons.id, personId),
        eq(persons.rowVersion, expectedVersion),
      ),
    )
    .returning({ rowVersion: persons.rowVersion });
  if (updated) return updated.rowVersion;
  const current = await loadPerson(tx, ctx, personId);
  throw new CommandError(409, "VERSION_CONFLICT", {
    expectedVersion,
    currentVersion: current.rowVersion,
  });
}

/** Ends the person's open link, if any, in the name of this command. */
async function endOpenLink(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  personId: string,
): Promise<void> {
  await tx
    .update(personLogins)
    .set({ endedAt: sql`now()`, endedByCommandId: envelope.commandId })
    .where(
      and(
        eq(personLogins.workspaceId, ctx.workspaceId),
        eq(personLogins.personId, personId),
        isNull(personLogins.endedAt),
      ),
    );
}

function loginState(membership: MembershipState | null, rowVersion: number) {
  return {
    membershipId: membership?.id ?? null,
    principalId: membership?.principalId ?? null,
    rowVersion,
  };
}

registerCommand<LinkPersonLoginPayload>({
  name: "link-person-login",
  version: 1,
  module: "CORE",
  allowedRoles: MEMBER_ADMIN_ROLES,
  payloadSchema: linkPersonLoginPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => personBranch(tx, ctx, payload.personId),
  },

  async execute(tx, ctx, envelope, payload) {
    const actor = await beginMemberAdministration(tx, ctx);
    const expectedVersion = requireExpectedVersion(envelope);

    const person = await loadPerson(tx, ctx, payload.personId);
    if (!person.active) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "person",
        referenceCode: payload.personId,
        reason: "inactive",
      });
    }
    const login = await loginToLink(tx, ctx, payload.principalId);
    assertMayManage(actor, { role: login.role, branchScope: branchScopeOf(login) });

    if (person.membershipId === login.id) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", { from: "LINKED", to: "LINKED" });
    }
    const previous =
      person.membershipId === null ? null : await currentLogin(tx, ctx, person.membershipId);
    // Relinking takes the login away from the old holder too.
    if (previous) assertMayManage(actor, { role: previous.role, branchScope: branchScopeOf(previous) });

    const [holder] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.workspaceId, ctx.workspaceId), eq(persons.membershipId, login.id)))
      .limit(1);
    if (holder) {
      throw new CommandError(409, "LOGIN_ALREADY_LINKED", {
        principalId: payload.principalId,
        personId: holder.id,
      });
    }

    const rowVersion = await setCurrentLogin(tx, ctx, person.id, login.id, expectedVersion);
    await endOpenLink(tx, ctx, envelope, person.id);
    await tx.insert(personLogins).values({
      workspaceId: ctx.workspaceId,
      personId: person.id,
      membershipId: login.id,
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: previous ? "person.login-relinked" : "person.login-linked",
      entityType: "person",
      entityId: person.id,
      beforeState: loginState(previous, person.rowVersion),
      afterState: loginState(login, rowVersion),
      changedFields: ["membershipId"],
    });

    return { recordId: person.id, rowVersion };
  },
});

registerCommand<UnlinkPersonLoginPayload>({
  name: "unlink-person-login",
  version: 1,
  module: "CORE",
  allowedRoles: MEMBER_ADMIN_ROLES,
  payloadSchema: unlinkPersonLoginPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => personBranch(tx, ctx, payload.personId),
  },

  async execute(tx, ctx, envelope, payload) {
    const actor = await beginMemberAdministration(tx, ctx);
    const expectedVersion = requireExpectedVersion(envelope);

    const person = await loadPerson(tx, ctx, payload.personId);
    // The person is there; unlinking a person with no login would change
    // nothing, so the caller's screen is stale.
    if (person.membershipId === null) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", { from: "UNLINKED", to: "UNLINKED" });
    }
    const previous = await currentLogin(tx, ctx, person.membershipId);
    assertMayManage(actor, { role: previous.role, branchScope: branchScopeOf(previous) });

    const rowVersion = await setCurrentLogin(tx, ctx, person.id, null, expectedVersion);
    await endOpenLink(tx, ctx, envelope, person.id);

    // The login, the person and everything either one recorded stay (§10).
    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "person.login-unlinked",
      entityType: "person",
      entityId: person.id,
      beforeState: loginState(previous, person.rowVersion),
      afterState: loginState(null, rowVersion),
      changedFields: ["membershipId"],
    });

    return { recordId: person.id, rowVersion };
  },
});
