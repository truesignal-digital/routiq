import { createHmac } from "node:crypto";

/**
 * The env var holding the key. Absent means the API refuses to start: a
 * silently unkeyed fallback would restore the attack this module exists to
 * close, and it would do so invisibly.
 */
export const PAYLOAD_HMAC_KEY_ENV = "COMMAND_PAYLOAD_HMAC_KEY";

/** 32 bytes of entropy, hex-encoded, is the shape `openssl rand -hex 32` gives. */
export const MIN_KEY_LENGTH = 32;

let cachedKey: string | undefined;

/**
 * Why the fingerprint is keyed rather than a plain digest.
 *
 * A receipt keeps everything about a command except its secret: the payload of
 * a PIN reset still names the principal, and the canonical JSON shape is in
 * this repository. An unkeyed SHA-256 would therefore be offline-brute-forcible
 * by anyone holding a database copy — a backup, a replica, a stolen dump —
 * because there are only ten thousand four-digit PINs to hash and compare. The
 * digest would leak exactly the value redaction removed.
 *
 * An HMAC under a key that lives in the environment, not the database, breaks
 * that: a database copy alone is not enough to test a guess.
 *
 * Rotating the key invalidates every stored fingerprint, so retries of commands
 * issued before the rotation stop replaying and answer IDEMPOTENCY_KEY_REUSED
 * instead. Idempotency keys only have to survive an outbox's retry window, so
 * rotate during a quiet period rather than mid-sync.
 */
export function commandPayloadHmacKey(): string {
  if (cachedKey !== undefined) return cachedKey;

  const key = process.env[PAYLOAD_HMAC_KEY_ENV];
  if (key === undefined || key.length === 0) {
    throw new Error(
      `${PAYLOAD_HMAC_KEY_ENV} is not set. Command receipts need it to fingerprint ` +
        `payloads without storing them; generate one with \`openssl rand -hex 32\`.`,
    );
  }
  if (key.length < MIN_KEY_LENGTH) {
    throw new Error(
      `${PAYLOAD_HMAC_KEY_ENV} must be at least ${MIN_KEY_LENGTH} characters; ` +
        `generate one with \`openssl rand -hex 32\`.`,
    );
  }

  cachedKey = key;
  return cachedKey;
}

/** Exported for the tests that need two keys in one process. */
export function fingerprintWith(key: string, canonical: string): string {
  return createHmac("sha256", key).update(canonical).digest("hex");
}

/** The fingerprint stored in `commands.payload_hash`, under the configured key. */
export function fingerprintCanonical(canonical: string): string {
  return fingerprintWith(commandPayloadHmacKey(), canonical);
}

/** Test seam: forces the next read to go back to the environment. */
export function resetCommandPayloadHmacKey(): void {
  cachedKey = undefined;
}
