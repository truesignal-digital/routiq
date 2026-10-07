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
} as const;
