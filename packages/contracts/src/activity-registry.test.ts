import { describe, expect, it } from "vitest";
import {
  ACTIVITY_COMPLETENESS_CODES,
  COMMAND_ERROR_CODES,
  COMMAND_WARNING_CODES,
} from "./errors.js";
import { MODULE_CODES, TOGGLEABLE_MODULE_CODES } from "./modules.js";

describe("activities public registry", () => {
  it("exposes the activities module as toggleable", () => {
    expect(MODULE_CODES).toContain("ACTIVITIES");
    expect(TOGGLEABLE_MODULE_CODES).toContain("ACTIVITIES");
  });

  it("exposes the stable activity vocabulary", () => {
    expect(COMMAND_ERROR_CODES).toContain("ACTIVITY_CLOSE_BLOCKED");
    expect(COMMAND_WARNING_CODES).toEqual(
      expect.arrayContaining([
        "ACTIVITY_MISSING_START_READING",
        "ACTIVITY_MISSING_END_READING",
        "ACTIVITY_NO_LEGS",
        "ACTIVITY_MISSING_CREW",
        "ACTIVITY_NO_REVENUE",
        "ACTIVITY_OPEN_SEGMENT_AUTOCLOSED",
        "METER_READING_DECREASED",
        "POSTING_DEFERRED_PERIOD_LOCKED",
      ]),
    );
  });

  it("keeps completeness codes a subset of the warning vocabulary", () => {
    // Codes are stored on activities.completeness_codes AND returned as warnings.
    // Two lists would drift; this proves there is only one.
    const warnings = new Set<string>(COMMAND_WARNING_CODES);
    const strays = ACTIVITY_COMPLETENESS_CODES.filter((code) => !warnings.has(code));
    expect(strays).toEqual([]);
  });
});
