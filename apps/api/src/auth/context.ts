import { and, eq, isNull } from "drizzle-orm";
import { memberships, principals } from "../db/schema.js";
import type { Db } from "../db/client.js";
import type { AuthContext, OperatorContext, VerifiedIdentity } from "./types.js";

export async function resolveAuthContext(
  db: Db,
  identity: VerifiedIdentity,
): Promise<AuthContext | null> {
  const [row] = await db
    .select({ membership: memberships, principalType: principals.principalType })
    .from(memberships)
    .innerJoin(principals, eq(memberships.principalId, principals.id))
    .where(
      and(
        eq(memberships.workspaceId, identity.workspaceId),
        eq(memberships.principalId, identity.principalId),
        // A deactivated member holding an unexpired token resolves to no
        // context at all, so revocation takes effect on the next request
        // rather than when the session happens to expire.
        isNull(memberships.deactivatedAt),
      ),
    );

  if (!row) return null;
  return {
    workspaceId: row.membership.workspaceId,
    principalId: row.membership.principalId,
    principalType: row.principalType,
    membershipId: row.membership.id,
    role: row.membership.role,
    // ADR-0009: Direction always covers every branch, whatever the row says.
    branchScope:
      row.membership.role === "DIRECTOR" || row.membership.allBranches
        ? "ALL"
        : row.membership.branchIds,
  };
}

/**
 * A vendor operator's identity is its principals row alone: no membership, no
 * credentials — the CLI's database access is the credential (ADR-0004), the row
 * exists so provisioning has provenance. Any other principal type is refused
 * here rather than at the command, so the platform path has one entry.
 */
export async function resolveOperatorContext(
  db: Db,
  principalId: string,
): Promise<OperatorContext | null> {
  const [row] = await db
    .select({ id: principals.id, displayName: principals.displayName })
    .from(principals)
    .where(
      and(
        eq(principals.id, principalId),
        eq(principals.principalType, "VENDOR_OPERATOR"),
        isNull(principals.disabledAt),
      ),
    );

  if (!row) return null;
  return {
    kind: "platform",
    principalId: row.id,
    principalType: "VENDOR_OPERATOR",
    displayName: row.displayName,
  };
}
