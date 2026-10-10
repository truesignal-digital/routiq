import { z } from "zod";
import { SUMMARY_SCHEDULES } from "../commands/set-summary-schedule.js";

/**
 * `GET /v1/company-settings`, Direction only (#669): the company-wide
 * settings that belong to no module. Today the Dashboard summary schedule.
 */
export const companySettingsResponse = /* @__PURE__ */ (() =>
  z.object({
    /** The schedule the Overviews follow; the default until Direction changes it. */
    summarySchedule: z.enum(SUMMARY_SCHEDULES),
    /** The envelope's `expectedVersion` for `set-summary-schedule`: 0 until it was first set. */
    version: z.number().int().nonnegative(),
  }))();

export type CompanySettingsResponse = z.infer<typeof companySettingsResponse>;
