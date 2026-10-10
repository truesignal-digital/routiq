import { z } from "zod";
import { SUMMARY_SCHEDULES } from "../commands/set-summary-schedule.js";
import { moneyMinor } from "../envelope.js";

/**
 * The summary notice on every Overview (dashboards.html#rule, #667): one
 * sentence that shows on a schedule and when something big changes, and that
 * each person can close until the next one.
 *
 * The company picks the schedule (Company settings › Dashboard summary, #669):
 * every Monday and the 1st of the month by default (the 1st talks about last
 * month), Mondays only, the 1st only, or never. When a day is both, it is the
 * 1st.
 */
export const SUMMARY_SCHEDULE_REASONS = ["MONDAY", "MONTH_START"] as const;
export type SummaryScheduleReason = (typeof SUMMARY_SCHEDULE_REASONS)[number];

/**
 * What counts as a big change: a vehicle grounded in the last
 * `GROUNDED_CHANGE_DAYS` days and still off the road, or the month's expenses
 * at least `EXPENSES_UP_PERCENT` % above the same days of last month.
 */
export const SUMMARY_CHANGE_KINDS = ["VEHICLE_GROUNDED", "EXPENSES_UP"] as const;
export const GROUNDED_CHANGE_DAYS = 7;
export const EXPENSES_UP_PERCENT = 20;

/**
 * The money summary's sentence (dashboards.html, summary sentence rules). The
 * server picks one; the web renders it as a whole ICU sentence in fr-CM or en.
 * AHEAD and BEHIND are better and worse than the comparison: more profit, or
 * fewer expenses, is AHEAD. FLAT is a change of at most `FLAT_PERCENT` %.
 * NOT_ENOUGH_DATA gives no comparison (nothing posted yet, or fewer than half
 * the month's trips closed); FIRST_MONTH has nothing earlier to compare with.
 */
export const SUMMARY_TEMPLATES = ["AHEAD", "BEHIND", "FLAT", "NOT_ENOUGH_DATA", "FIRST_MONTH"] as const;
export type SummaryTemplate = (typeof SUMMARY_TEMPLATES)[number];
export const FLAT_PERCENT = 2;

/** PROFIT for a company that records revenue and a viewer who reads profit; EXPENSES otherwise. */
export const SUMMARY_MEASURES = ["PROFIT", "EXPENSES"] as const;

/** The month so far against the same days of last month; from the 1st to the 2nd, last month against the one before. */
export const SUMMARY_WINDOWS = ["MONTH_SO_FAR", "LAST_MONTH"] as const;

/** Why a NOT_ENOUGH_DATA summary has no comparison. */
export const SUMMARY_SHORT_OF = ["ENTRIES", "CLOSED_TRIPS"] as const;

/**
 * When the notice shows. Built by a function so each response composes it
 * inside its own pure call and the web build drops it.
 */
export function overviewNoticeSchema() {
  return z.object({
    /** The workspace's business date. */
    today: z.iso.date(),
    /**
     * The company's schedule. NEVER shows tiles only: no scheduled summary
     * and no notice for a big change; "Show summary" still opens it.
     */
    schedule: z.enum(SUMMARY_SCHEDULES),
    /**
     * The latest scheduled day on or before today under `schedule`: the last
     * Monday or the 1st, whichever is later, by default. A person who closes
     * the notice closes it for this day's summary; the next scheduled day
     * brings it back. Null when the schedule is NEVER.
     */
    scheduledOn: z.iso.date().nullable(),
    /** Why today is a scheduled day; null on the other days. */
    scheduledToday: z.enum(SUMMARY_SCHEDULE_REASONS).nullable(),
    /**
     * Big changes, each shown until the person closes the notice. `key` is
     * stable for one change: the same grounding keeps its key every day.
     */
    changes: z.array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("VEHICLE_GROUNDED"),
          key: z.string(),
          assetId: z.uuid(),
          assetCode: z.string(),
          since: z.iso.datetime(),
        }),
        z.object({
          kind: z.literal("EXPENSES_UP"),
          key: z.string(),
          /** The money summary's period and comparison expenses. */
          expenseMinor: moneyMinor,
          comparisonExpenseMinor: moneyMinor,
          percent: z.number().int().nonnegative(),
        }),
      ]),
    ),
  });
}

export type OverviewNotice = z.infer<ReturnType<typeof overviewNoticeSchema>>;
export type OverviewNoticeChange = OverviewNotice["changes"][number];

/** The money summary in `GET /v1/finance/overview`, composed like the notice. */
export function moneySummarySchema() {
  const window = z.object({ from: z.iso.date(), to: z.iso.date() });
  return z.object({
    template: z.enum(SUMMARY_TEMPLATES),
    measure: z.enum(SUMMARY_MEASURES),
    window: z.enum(SUMMARY_WINDOWS),
    period: window,
    comparison: window,
    /** Profit or expenses in each window, signed minor units of the response currency. */
    currentMinor: moneyMinor,
    comparisonMinor: moneyMinor,
    /** The period's revenue; null unless the measure is PROFIT. */
    revenueMinor: moneyMinor.nullable(),
    /** |change| ÷ comparison, rounded; null when the comparison is zero or a loss. */
    changePercent: z.number().int().nonnegative().nullable(),
    /**
     * The line that moved the result most in its direction, for AHEAD and
     * BEHIND: revenue (PROFIT only) or one expense category. `changeMinor` is
     * that line's period minus comparison. Null otherwise.
     */
    reason: z
      .object({
        kind: z.enum(["REVENUE", "CATEGORY"]),
        category: z.object({ code: z.string(), labelFr: z.string(), labelEn: z.string() }).nullable(),
        changeMinor: moneyMinor,
      })
      .nullable(),
    /** Set for NOT_ENOUGH_DATA only. */
    shortOf: z.enum(SUMMARY_SHORT_OF).nullable(),
    /** Trips closed in the period and open now; null when Trips is off. */
    trips: z
      .object({ closed: z.number().int().nonnegative(), open: z.number().int().nonnegative() })
      .nullable(),
  });
}

export type MoneySummary = z.infer<ReturnType<typeof moneySummarySchema>>;
