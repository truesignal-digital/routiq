import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Company settings › Dashboard summary (#669, dashboards.html#rule): when the
 * summary notice shows on every Overview. Direction picks one for the whole
 * company; each person can still close the notice.
 *
 * MONDAY_AND_MONTH_START (the default) is every Monday and the 1st of the
 * month; NEVER shows tiles only: no scheduled summary and no notice for a big
 * change. "Show summary" still opens it on request.
 */
export const SUMMARY_SCHEDULES = ["MONDAY_AND_MONTH_START", "MONDAY", "MONTH_START", "NEVER"] as const;
export type SummarySchedule = (typeof SUMMARY_SCHEDULES)[number];
export const DEFAULT_SUMMARY_SCHEDULE: SummarySchedule = "MONDAY_AND_MONTH_START";

/**
 * The envelope's `expectedVersion` is the `version` the company-settings read
 * returned: 0 while the company still has the default.
 */
export const setSummarySchedulePayload = z.strictObject({
  schedule: z.enum(SUMMARY_SCHEDULES),
});

// Only the API and tests use the whole command; the pure mark lets the web build drop it.
export const setSummaryScheduleCommand = /* @__PURE__ */ (() =>
  z.strictObject({
    name: z.literal("set-summary-schedule"),
    version: z.literal(1),
    envelope: commandEnvelope,
    payload: setSummarySchedulePayload,
  }))();

export type SetSummarySchedulePayload = z.infer<typeof setSummarySchedulePayload>;
export type SetSummaryScheduleCommand = z.infer<typeof setSummaryScheduleCommand>;
