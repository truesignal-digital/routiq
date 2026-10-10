import type { OverviewRange } from "@routiq/contracts";

function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/**
 * "October 1 – 10" for a month so far, "July – September 2026" for whole
 * months: an Overview window in words. Core, so every Overview that reads a
 * range (Money, the Dashboard, Trucks, Trips) labels it the same way.
 */
export function windowLabel(
  window: { from: string; to: string },
  range: OverviewRange,
  language: string | undefined,
  style: "long" | "short" = "long",
): string {
  const options: Intl.DateTimeFormatOptions =
    range === "THIS_MONTH"
      ? { month: style, day: "numeric", timeZone: "UTC" }
      : { month: style, year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(language, options).formatRange(utcDate(window.from), utcDate(window.to));
}
