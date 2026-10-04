import {
  grantableRoles,
  MEMBER_ADMIN_ROLES,
  type BranchScope,
  type MemberListItem,
  type Role,
} from "@routiq/contracts";

/**
 * Who opens member administration at all: Direction, and the Administrateur
 * for the field roles of their own branches (ADR-0009). Anyone else is offered
 * no Users entry rather than a screen that answers 403.
 *
 * No module gate — member administration is CORE, which cannot be disabled.
 */
export function canAdministerMembers(role: Role | undefined): boolean {
  return role !== undefined && (MEMBER_ADMIN_ROLES as readonly Role[]).includes(role);
}

/** The actor as the member rules read them. */
export interface MemberActor {
  principalId: string;
  role: Role;
  branchScope: BranchScope;
}

/** The roles the role pickers offer this actor; the server checks the same list. */
export function pickableRoles(actor: Pick<MemberActor, "role"> | undefined): readonly Role[] {
  return actor === undefined ? [] : grantableRoles(actor.role);
}

/** Whether `scope` sits inside the actor's own branches. ALL fits only an ALL actor. */
export function scopeWithinActor(actorScope: BranchScope, scope: BranchScope): boolean {
  if (actorScope === "ALL") return true;
  if (scope === "ALL") return false;
  return scope.every((branchId) => actorScope.includes(branchId));
}

/**
 * Whether the actor may act on this member at all: a role they may grant, in
 * branches they hold. The server answers MEMBER_ROLE_NOT_GRANTABLE or
 * MEMBER_BRANCH_OUT_OF_SCOPE otherwise.
 */
export function canManageMember(
  actor: MemberActor | undefined,
  member: Pick<MemberListItem, "role" | "branchScope">,
): boolean {
  if (actor === undefined) return false;
  return (
    pickableRoles(actor).includes(member.role) &&
    scopeWithinActor(actor.branchScope, member.branchScope)
  );
}

/** Nobody changes their own role or branches (server: SELF_ROLE_CHANGE). */
export function canEditMemberRole(
  actor: MemberActor | undefined,
  member: Pick<MemberListItem, "principalId" | "role" | "branchScope">,
): boolean {
  return (
    actor !== undefined &&
    actor.principalId !== member.principalId &&
    canManageMember(actor, member)
  );
}

/** Direction always covers every branch (server: DIRECTOR_REQUIRES_ALL_BRANCHES). */
export function roleRequiresAllBranches(role: Role | string | undefined): boolean {
  return role === "DIRECTOR";
}
