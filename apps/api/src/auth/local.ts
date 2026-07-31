import { createHash, randomBytes } from "node:crypto";
import type { LoginRequest } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { credentials, principals, sessions, workspaces } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { hashPin, verifyPin } from "./pin.js";
import type { IdentityProvider, VerifiedIdentity } from "./types.js";

/** §6: sessions must survive the max plausible offline window (≥ 14 days). */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 5 wrong PINs lock the credential for 15 minutes; a correct login resets the counter. */
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

/** Verified on unknown-username paths so lookup misses cost the same as a wrong PIN. */
const DUMMY_PIN_HASH = await hashPin(randomBytes(8).toString("hex"));

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The insert itself, over anything that can run one — a pool or a transaction. */
async function createSessionIn(
  executor: Pick<Db, "insert">,
  opts: { principalId: string; workspaceId: string; ttlMs?: number },
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? SESSION_TTL_MS));
  await executor.insert(sessions).values({
    principalId: opts.principalId,
    workspaceId: opts.workspaceId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

export function createSession(
  db: Db,
  opts: { principalId: string; workspaceId: string; ttlMs?: number },
) {
  return createSessionIn(db, opts);
}

export type LoginResult =
  | { ok: true; session: { token: string; expiresAt: Date } }
  | { ok: false; code: "AUTH_INVALID_CREDENTIALS" | "AUTH_LOCKED"; retryAfterSeconds?: number };

export async function loginWithPin(db: Db, input: LoginRequest): Promise<LoginResult> {
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
    return { ok: false as const, code: "AUTH_INVALID_CREDENTIALS" as const };
  }

  const now = Date.now();
  if (row.credential.lockedUntil && row.credential.lockedUntil.getTime() > now) {
    await verifyPin(input.pin, DUMMY_PIN_HASH);
    return {
      ok: false as const,
      code: "AUTH_LOCKED" as const,
      retryAfterSeconds: Math.ceil((row.credential.lockedUntil.getTime() - now) / 1000),
    };
  }

  if (!(await verifyPin(input.pin, row.credential.pinHash))) {
    const failedAttempts = row.credential.failedAttempts + 1;
    await db
      .update(credentials)
      .set(
        failedAttempts >= MAX_PIN_ATTEMPTS
          ? { failedAttempts: 0, lockedUntil: new Date(now + PIN_LOCKOUT_MS) }
          : { failedAttempts },
      )
      .where(eq(credentials.id, row.credential.id));
    return { ok: false as const, code: "AUTH_INVALID_CREDENTIALS" as const };
  }

  /**
   * The PIN was verified against a row read outside any transaction, and
   * `reset-member-pin` may have replaced that row since — deleting this
   * principal's sessions as it went. A session inserted afterwards would
   * outlive the reset while carrying the authority of a PIN that no longer
   * opens anything, which is exactly what resetting a forgotten or leaked PIN
   * is meant to end.
   *
   * So the session is minted under a row lock on the credential, after
   * re-reading it. `SELECT ... FOR UPDATE` closes the window rather than
   * narrowing it: the reset's UPDATE of that row either lands before this lock
   * is taken, in which case the re-read sees a different `pin_hash` and the
   * login fails, or it waits behind this transaction and then deletes the
   * session this one just minted. Either order leaves no session standing on
   * the old PIN.
   *
   * Lock order matches the reset command's — credential first, then sessions —
   * so the two cannot deadlock.
   */
  const session = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(credentials)
      .where(eq(credentials.id, row.credential.id))
      .for("update");

    if (!current || current.disabledAt || current.pinHash !== row.credential.pinHash) {
      return null;
    }

    if (current.failedAttempts > 0 || current.lockedUntil) {
      await tx
        .update(credentials)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(credentials.id, current.id));
    }

    return createSessionIn(tx, {
      principalId: current.principalId,
      workspaceId: row.workspaceId,
    });
  });

  if (!session) return { ok: false as const, code: "AUTH_INVALID_CREDENTIALS" as const };
  return { ok: true as const, session };
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
