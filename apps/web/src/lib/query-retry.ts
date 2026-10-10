/**
 * A read that answered 404 — REFERENCE_NOT_FOUND, which is also how the API
 * says "outside your branches" — will answer 404 again. The read hooks throw
 * `<READ>_<status>`, so the status is the message's tail.
 */
export function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.endsWith("_404") || error.message.includes("REFERENCE_NOT_FOUND"))
  );
}

/** Answers that come back the same however often they are asked again. */
const REFUSED_STATUSES = ["_401", "_403", "_404", "_409"];

/**
 * The server refused the read (signed out, not allowed, not there, in
 * conflict), or there is no session to ask with. Asking again only delays the
 * screen's answer and holds back the background screen preload (#600).
 */
export function isRefused(error: unknown): boolean {
  return (
    error instanceof Error &&
    (REFUSED_STATUSES.some((status) => error.message.endsWith(status)) ||
      error.message === "AUTH_REQUIRED" ||
      isNotFound(error))
  );
}

/**
 * The shared Query client's `retry`: three retries like the library default,
 * none for a refusal.
 */
export function retryRead(failureCount: number, error: unknown): boolean {
  return !isRefused(error) && failureCount < 3;
}

/**
 * Query `retry` for reads that can miss: at most two retries, none for a 404
 * or another refusal, so a record that is not there shows its not-found state
 * at once instead of after the default backoff (1 s + 2 s + 4 s).
 */
export function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !isRefused(error) && failureCount < 2;
}
