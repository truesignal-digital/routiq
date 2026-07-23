import { createHash, randomBytes } from "node:crypto";
import type { LoginRequest } from "@asset/contracts";
import { and, eq } from "drizzle-orm";
import { credentials, principals, sessions, workspaces } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { hashPin, verifyPin } from "./pin.js";
import type { IdentityProvider, VerifiedIdentity } from "./types.js";

/** §6: sessions must survive the max plausible offline window (≥ 14 days). */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Verified on unknown-username paths so lookup misses cost the same as a wrong PIN. */
const DUMMY_PIN_HASH = await hashPin(randomBytes(8).toString("hex"));

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  opts: { principalId: string; workspaceId: string; ttlMs?: number },
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? SESSION_TTL_MS));
  await db.insert(sessions).values({
    principalId: opts.principalId,
    workspaceId: opts.workspaceId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function loginWithPin(db: Db, input: LoginRequest) {
  const [row] = await db
    .select({
      credential: credentials,
      principalDisabledAt: principals.disabledAt,
      workspaceId: workspaces.id,
    })
    .from(credentials)
    .innerJoin(workspaces, eq(credentials.workspaceId, workspaces.id))
    .innerJoin(principals, eq(credentials.principalId, principals.id))
    .where(
      and(eq(workspaces.slug, input.workspaceSlug), eq(credentials.username, input.username)),
    );

  if (!row || row.credential.disabledAt || row.principalDisabledAt) {
    await verifyPin(input.pin, DUMMY_PIN_HASH);
    return null;
  }
  if (!(await verifyPin(input.pin, row.credential.pinHash))) return null;

  return createSession(db, {
    principalId: row.credential.principalId,
    workspaceId: row.workspaceId,
  });
}

/** Local implementation of the identity seam: opaque tokens in the sessions table. */
export class LocalSessionProvider implements IdentityProvider {
  constructor(private readonly db: Db) {}

  async verifyToken(token: string): Promise<VerifiedIdentity | null> {
    const [row] = await this.db
      .select({ session: sessions, principalDisabledAt: principals.disabledAt })
      .from(sessions)
      .innerJoin(principals, eq(sessions.principalId, principals.id))
      .where(eq(sessions.tokenHash, hashToken(token)));

    if (!row || row.principalDisabledAt) return null;
    if (row.session.expiresAt.getTime() <= Date.now()) return null;
    return { principalId: row.session.principalId, workspaceId: row.session.workspaceId };
  }
}
