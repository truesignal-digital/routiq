import { describe, expect, it } from "vitest";
import {
  activityRequirements,
  evaluateCompleteness,
  type ActivityRequirements,
  type CompletenessInput,
} from "./completeness.js";

/** No fixture, no container: the evaluator is pure so every branch is cheap to pin. */
describe("evaluateCompleteness", () => {
  const full: ActivityRequirements = {
    legs: true,
    crew: true,
    revenue: true,
    startReading: true,
    endReading: true,
  };

  function input(overrides: Partial<CompletenessInput> = {}): CompletenessInput {
    return {
      startedAt: new Date("2026-07-14T06:10:00Z"),
      endedAt: new Date("2026-07-15T09:00:00Z"),
      segments: [
        {
          role: "PRIMARY",
          endedAt: new Date("2026-07-15T09:00:00Z"),
          startReadingId: "r1",
          endReadingId: "r2",
        },
      ],
      legCount: 4,
      crewCount: 2,
      revenueEntryCount: 1,
      requirements: full,
      ...overrides,
    };
  }

  it("passes a complete job with no codes", () => {
    expect(evaluateCompleteness(input())).toEqual({
      closeable: true,
      completeness: "COMPLETE",
      codes: [],
    });
  });

  describe("the only two hard blocks", () => {
    it("blocks without actual dates", () => {
      expect(evaluateCompleteness(input({ endedAt: null }))).toEqual({
        closeable: false,
        blockedBy: ["MISSING_ACTUAL_DATES"],
      });
    });

    it("blocks without an asset segment", () => {
      expect(evaluateCompleteness(input({ segments: [] }))).toEqual({
        closeable: false,
        blockedBy: ["NO_ASSET_SEGMENT"],
      });
    });

    it("reports both when both are missing", () => {
      const result = evaluateCompleteness(input({ startedAt: null, segments: [] }));
      expect(result).toEqual({
        closeable: false,
        blockedBy: ["MISSING_ACTUAL_DATES", "NO_ASSET_SEGMENT"],
      });
    });
  });

  describe("everything else warns", () => {
    it("closes without legs", () => {
      const result = evaluateCompleteness(input({ legCount: 0 }));
      expect(result).toMatchObject({
        closeable: true,
        completeness: "COMPLETE_WITH_EXCEPTIONS",
      });
      expect(result).toHaveProperty("codes", ["ACTIVITY_NO_LEGS"]);
    });

    it("closes without crew, revenue or readings, listing each", () => {
      const result = evaluateCompleteness(
        input({
          legCount: 0,
          crewCount: 0,
          revenueEntryCount: 0,
          segments: [
            { role: "PRIMARY", endedAt: new Date(), startReadingId: null, endReadingId: null },
          ],
        }),
      );
      expect(result).toMatchObject({ completeness: "COMPLETE_WITH_EXCEPTIONS" });
      expect(result).toHaveProperty("codes", [
        "ACTIVITY_NO_LEGS",
        "ACTIVITY_MISSING_CREW",
        "ACTIVITY_NO_REVENUE",
        "ACTIVITY_MISSING_START_READING",
        "ACTIVITY_MISSING_END_READING",
      ]);
    });

    it("records that a dangling segment had to be auto-closed", () => {
      const result = evaluateCompleteness(
        input({
          segments: [
            { role: "PRIMARY", endedAt: null, startReadingId: "r1", endReadingId: "r2" },
          ],
        }),
      );
      expect(result).toHaveProperty("codes", ["ACTIVITY_OPEN_SEGMENT_AUTOCLOSED"]);
    });

    it("ignores readings on trailers — only carriers are metered", () => {
      const result = evaluateCompleteness(
        input({
          segments: [
            {
              role: "PRIMARY",
              endedAt: new Date(),
              startReadingId: "r1",
              endReadingId: "r2",
            },
            { role: "TRAILER", endedAt: new Date(), startReadingId: null, endReadingId: null },
          ],
        }),
      );
      expect(result).toEqual({ closeable: true, completeness: "COMPLETE", codes: [] });
    });
  });

  /**
   * The genericity property. A plant-hire activity is an excavator standing on a
   * site: no legs, ever. If the rule were a constant rather than per-template
   * data, that whole business would read as permanently incomplete.
   */
  describe("requirements are per template, not universal", () => {
    const hire: ActivityRequirements = {
      legs: false,
      crew: true,
      revenue: true,
      startReading: true,
      endReading: true,
    };

    it("does not flag a legless activity when the preset does not want legs", () => {
      expect(evaluateCompleteness(input({ legCount: 0, requirements: hire }))).toEqual({
        closeable: true,
        completeness: "COMPLETE",
        codes: [],
      });
    });

    it("still flags the same activity under a preset that wants legs", () => {
      expect(evaluateCompleteness(input({ legCount: 0, requirements: full }))).toMatchObject(
        { completeness: "COMPLETE_WITH_EXCEPTIONS" },
      );
    });
  });

  describe("activityRequirements", () => {
    it("serves both shipped presets", () => {
      expect(activityRequirements("TRUCKING").legs).toBe(true);
      expect(activityRequirements("PASSENGER_TRANSPORT").legs).toBe(true);
    });

    it("refuses a preset it has no rules for, rather than guessing", () => {
      expect(() => activityRequirements("PLANT_HIRE")).toThrow(/PLANT_HIRE/);
    });
  });
});
