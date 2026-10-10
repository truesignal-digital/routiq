/**
 * The workspace's calendar (#639): "today" and "this month" cut at the
 * workspace's midnight, as the server's `currentBusinessDate` does, never at
 * the device's. A phone in another zone, or a clock past midnight, must not
 * move them.
 */
export function workspaceToday(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The workspace's current month, `YYYY-MM`. */
export function workspaceMonth(timezone: string, now: Date = new Date()): string {
  return workspaceToday(timezone, now).slice(0, 7);
}
