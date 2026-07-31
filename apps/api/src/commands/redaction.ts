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

/** Key names whose value is a secret whatever command it arrived on. */
const SECRET_KEY = /pin|password|secret/i;

/**
 * The fallback for a payload no command claimed. A declared `redactPayload`
 * knows its own shape and is always preferred; this one runs when there is no
 * definition to ask — an unknown command name, an unsupported version, a
 * platform command reached through the workspace route — all of which still
 * leave a REJECTED receipt behind carrying whatever the caller sent.
 *
 * Deliberately blunt and recursive: it cannot know which key holds the secret,
 * so it strips every key that looks like one at any depth. Over-redacting a
 * rejected receipt costs a little debugging context; under-redacting one
 * persists a credential forever.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      SECRET_KEY.test(key) ? REDACTED_PIN : redactSecrets(entryValue),
    ]),
  );
}
