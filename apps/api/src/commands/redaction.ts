/**
 * Stands in for every PIN in a stored receipt. Exported so tests assert the
 * exact marker rather than the absence of one particular string.
 */
export const REDACTED_PIN = "[REDACTED]";

/**
 * Replaces a top-level `pin` for the command receipt, leaving everything else
 * byte-identical so a genuinely different payload under a reused idempotency
 * key is still caught.
 *
 * Takes `unknown` rather than a parsed payload on purpose: a workspace command
 * also writes a receipt when validation failed, and a PIN inside a payload the
 * schema rejected is still a PIN. Anything that is not an object with a `pin`
 * passes through untouched, so an unparseable body is stored as it arrived.
 */
export function redactPin(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  if (!("pin" in payload)) return payload;
  return { ...payload, pin: REDACTED_PIN };
}
