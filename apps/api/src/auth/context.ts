import { and, eq } from "drizzle-orm";
import { memberships, principals } from "../db/schema.js";
import type { Db } from "../db/client.js";
import type { AuthContext, VerifiedIdentity } from "./types.js";

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
      ),
    );

  if (!row) return null;
  return {
    workspaceId: row.membership.workspaceId,
    principalId: row.membership.principalId,
    principalType: row.principalType,
    membershipId: row.membership.id,
    role: row.membership.role,
    branchScope: row.membership.allBranches ? "ALL" : row.membership.branchIds,
  };
}
