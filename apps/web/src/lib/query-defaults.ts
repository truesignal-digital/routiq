/**
 * How long a read counts as fresh: going back to a screen within this window
 * shows what is cached without asking again, and a route loader's read is not
 * fetched a second time when its screen mounts (#496). Writes still
 * invalidate what they change at once. Kept apart from query-client.ts, which
 * builds the cache when imported.
 */
export const FRESH_MS = 30_000;

/** Lists an administrator edits now and then: the member, categories, branches, asset classes (#495). */
export const REFERENCE_STALE_MS = 5 * 60_000;

/** The app's read defaults; tests that build their own client use them too. */
export const QUERY_DEFAULTS = {
  staleTime: FRESH_MS,
  // A route loader made the first attempt, retries included; a screen
  // mounting on its error shows it with a retry instead of asking again (a
  // 404 vehicle is one request, not two). The next navigation's loader tries
  // again.
  retryOnMount: false,
} as const;
