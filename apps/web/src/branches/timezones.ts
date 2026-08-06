/**
 * The zones a branch can plausibly sit in, as IANA identifiers. Deliberately a
 * short list rather than the full tz database: the pilot operates in Cameroon
 * and its neighbours, and a 400-entry picker on a low-end Android is worse than
 * a missing zone we can add in one line.
 *
 * Identifiers are not translated — they are the same string in every locale.
 */
export const BRANCH_TIMEZONES = [
  "Africa/Douala",
  "Africa/Bangui",
  "Africa/Brazzaville",
  "Africa/Lagos",
  "Africa/Libreville",
  "Africa/Malabo",
  "Africa/Ndjamena",
  "UTC",
] as const;

/** What a new branch gets unless the admin says otherwise (workspace default). */
export const DEFAULT_BRANCH_TIMEZONE = "Africa/Douala";
