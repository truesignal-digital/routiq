/**
 * Reads the shell loads before it draws and that change only when an
 * administrator edits them: the member, the branches. Without a freshness
 * window the shell would ask again for what its loader just fetched (#495).
 * Kept apart from query-client.ts, which builds the cache when imported.
 */
export const REFERENCE_STALE_MS = 5 * 60_000;
