import type { OverviewRange } from "@routiq/contracts";
import { formatDateRange } from "@/lib/format.js";

/**
 * "1–10 October" for a month so far, "July – September 2026" for whole
 * months: an Overview window in words. Core, so every Overview that reads a
 * range (Money, the Dashboard, Trucks, Trips) labels it the same way.
 */
export function windowLabel(
  window: { from: string; to: string },
  range: OverviewRange,
  language: string | undefined,
  style: "long" | "short" = "long",
): string {
  return formatDateRange(window.from, window.to, language, { unit: range === "THIS_MONTH" ? "days" : "months", month: style });
}
