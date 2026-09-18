// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatDateTime, formatDayLong, localDayKey } from "./format.js";

afterEach(() => vi.unstubAllEnvs());

it("keeps a financial calendar date on September 4 for a Chicago viewer", () => {
  vi.stubEnv("TZ", "America/Chicago");
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Chicago");
  expect(formatDate("2026-09-04", "fr-CM")).toBe("04/09/2026");
});

const calendarDates = [
  { iso: "2026-09-04", fr: "04/09/2026", en: "9/4/26" },
  { iso: "2026-01-01", fr: "01/01/2026", en: "1/1/26" },
  { iso: "2026-03-01", fr: "01/03/2026", en: "3/1/26" },
  { iso: "2024-02-29", fr: "29/02/2024", en: "2/29/24" },
  { iso: "2026-03-08", fr: "08/03/2026", en: "3/8/26" },
  { iso: "2026-11-01", fr: "01/11/2026", en: "11/1/26" },
];

for (const viewer of [
  {
    zone: "Africa/Douala",
    dateFr: "01/01/2026", dateEn: "1/1/26",
    timeFr: "01/01/2026 01:30", timeEn: "1/1/26, 1:30 AM",
    day: "2026-01-01", longFr: "1 janvier 2026",
  },
  {
    zone: "UTC",
    dateFr: "01/01/2026", dateEn: "1/1/26",
    timeFr: "01/01/2026 00:30", timeEn: "1/1/26, 12:30 AM",
    day: "2026-01-01", longFr: "1 janvier 2026",
  },
  {
    zone: "America/Chicago",
    dateFr: "31/12/2025", dateEn: "12/31/25",
    timeFr: "31/12/2025 18:30", timeEn: "12/31/25, 6:30 PM",
    day: "2025-12-31", longFr: "31 décembre 2025",
  },
]) {
  describe(`calendar dates versus timestamps in ${viewer.zone}`, () => {
    beforeEach(() => {
      vi.stubEnv("TZ", viewer.zone);
      expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(viewer.zone);
    });

    it.each(calendarDates)("preserves $iso across calendar and daylight-saving boundaries", ({ iso, fr, en }) => {
      expect(formatDate(iso, "fr-CM")).toBe(fr);
      expect(formatDate(iso, "en-US")).toBe(en);
    });

    it("still shifts the displayed date of a real timestamp to the viewer's day", () => {
      expect(formatDate("2026-01-01T00:30:00Z", "fr-CM")).toBe(viewer.dateFr);
      expect(formatDate("2026-01-01T00:30:00Z", "en-US")).toBe(viewer.dateEn);
      // The same instant expressed with a non-zero offset must behave identically.
      expect(formatDate("2026-01-01T01:30:00+01:00", "fr-CM")).toBe(viewer.dateFr);
    });

    it("preserves timestamp clock times in both languages", () => {
      expect(formatDateTime("2026-01-01T00:30:00Z", "fr-CM")).toBe(viewer.timeFr);
      expect(formatDateTime("2026-01-01T00:30:00Z", "en-US")).toBe(viewer.timeEn);
    });

    it("continues grouping and heading timestamp history by the viewer's day", () => {
      expect(localDayKey("2026-01-01T00:30:00Z")).toBe(viewer.day);
      expect(formatDayLong("2026-01-01T00:30:00Z", "fr-CM")).toBe(viewer.longFr);
    });
  });
}
