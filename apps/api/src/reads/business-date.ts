/**
 * Calendar-day arithmetic for read windows. "Today" is a business fact, not a
 * server-clock fact: an entry captured at 23:30 in Douala belongs to that day,
 * so the day boundary follows the workspace timezone — the same convention
 * `currentPeriodCode` uses for the month boundary.
 */

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' of the current instant in the workspace timezone. */
export function currentBusinessDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) throw new Error(`unresolvable timezone: ${timezone}`);
  return `${year}-${month}-${day}`;
}

/**
 * Shifts an ISO date by whole days. The math runs in UTC on purpose: a plain
 * date has no zone, and UTC has no DST, so "one day later" is never 23 or 25
 * hours the way it would be in a local-time Date.
 */
export function addDays(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`not an ISO date: ${isoDate}`);
  }
  const shifted = new Date(Date.UTC(year, month - 1, day) + delta * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/** The `days` calendar dates ending at `endDate`, ascending. */
export function dayWindow(endDate: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(endDate, i - days + 1));
}
