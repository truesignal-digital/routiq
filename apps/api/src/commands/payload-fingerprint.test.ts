import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  commandPayloadHmacKey,
  fingerprintWith,
  MIN_KEY_LENGTH,
  PAYLOAD_HMAC_KEY_ENV,
  resetCommandPayloadHmacKey,
} from "./payload-fingerprint.js";

const CANONICAL = '{"pin":"4821","principalId":"5f5f0b6e-1f5d-4f0f-9a2a-6a1d2b3c4d5e"}';

describe("command payload fingerprint", () => {
  const original = process.env[PAYLOAD_HMAC_KEY_ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[PAYLOAD_HMAC_KEY_ENV];
    else process.env[PAYLOAD_HMAC_KEY_ENV] = original;
    resetCommandPayloadHmacKey();
  });

  /**
   * The property the whole module exists for. Two deployments holding the same
   * receipt row derive different fingerprints from it, so a stolen database is
   * not enough to test a guess — which is what an unkeyed digest over a payload
   * whose only unknown is a four-digit PIN would have allowed.
   */
  it("gives different digests under different keys", () => {
    const one = fingerprintWith("a".repeat(MIN_KEY_LENGTH), CANONICAL);
    const two = fingerprintWith("b".repeat(MIN_KEY_LENGTH), CANONICAL);
    expect(one).not.toBe(two);
  });

  it("is stable for one key, so a genuine retry still matches", () => {
    const key = "c".repeat(MIN_KEY_LENGTH);
    expect(fingerprintWith(key, CANONICAL)).toBe(fingerprintWith(key, CANONICAL));
  });

  it("still separates different payloads under one key", () => {
    const key = "d".repeat(MIN_KEY_LENGTH);
    expect(fingerprintWith(key, CANONICAL)).not.toBe(
      fingerprintWith(key, CANONICAL.replace("4821", "1234")),
    );
  });

  /**
   * The brute force an attacker with a database copy would run: hash the
   * candidate payload and compare. It has to miss.
   */
  it("is not the unkeyed digest of the payload", () => {
    const unkeyed = createHash("sha256").update(CANONICAL).digest("hex");
    expect(fingerprintWith("e".repeat(MIN_KEY_LENGTH), CANONICAL)).not.toBe(unkeyed);
  });

  it("refuses to run without a key rather than falling back to an unkeyed digest", () => {
    delete process.env[PAYLOAD_HMAC_KEY_ENV];
    resetCommandPayloadHmacKey();
    expect(() => commandPayloadHmacKey()).toThrow(PAYLOAD_HMAC_KEY_ENV);
  });

  it("refuses a key too short to be worth having", () => {
    process.env[PAYLOAD_HMAC_KEY_ENV] = "short";
    resetCommandPayloadHmacKey();
    expect(() => commandPayloadHmacKey()).toThrow(String(MIN_KEY_LENGTH));
  });

  it("reads the configured key", () => {
    const key = "f".repeat(MIN_KEY_LENGTH);
    process.env[PAYLOAD_HMAC_KEY_ENV] = key;
    resetCommandPayloadHmacKey();
    expect(commandPayloadHmacKey()).toBe(key);
  });
});
