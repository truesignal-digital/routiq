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

/**
 * Query `retry` for reads that can miss: at most two retries, none for a 404,
 * so a record that is not there shows its not-found state at once instead of
 * after the default backoff (1 s + 2 s + 4 s).
 */
export function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !isNotFound(error) && failureCount < 2;
}
