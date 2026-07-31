import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  formatMoney,
  formatDate,
  formatDateTime,
  formatDayLong,
  localDayKey,
  localizedLabel,
} from "./format.js";
import { i18n } from "../i18n/index.js";

describe("format", () => {
  describe("formatMoney", () => {
    it("formats XAF with exponent 0 (no division)", () => {
      const result = formatMoney(150000, { currency: "XAF" });
      expect(result).toMatch(/150\s*000.*FCFA/);
    });

    it("includes currency in output", () => {
      const result = formatMoney(100, { currency: "XAF" });
      expect(result).toContain("FCFA");
    });

    it("respects signDisplay: always", () => {
      const positive = formatMoney(100, {
        currency: "XAF",
        signDisplay: "always",
      });
      const negative = formatMoney(-100, {
        currency: "XAF",
        signDisplay: "always",
      });
      expect(positive).toMatch(/^[+]/);
      expect(negative).toMatch(/^[-]/);
    });

    it("respects signDisplay: exceptZero", () => {
      const positive = formatMoney(100, {
        currency: "XAF",
        signDisplay: "exceptZero",
      });
      const zero = formatMoney(0, {
        currency: "XAF",
        signDisplay: "exceptZero",
      });
      expect(positive).toMatch(/^[+]/);
      expect(zero).not.toMatch(/^[+-]/);
    });

    it("respects signDisplay: never (no sign)", () => {
      const result = formatMoney(-100, {
        currency: "XAF",
        signDisplay: "never",
      });
      expect(result).not.toMatch(/^[-]/);
    });

    it("normalizes U+202F to regular space", () => {
      const result = formatMoney(150000, { currency: "XAF" });
      expect(result).not.toContain(" ");
      expect(result).toMatch(/\s/);
    });

    it("returns empty string for null/undefined", () => {
      expect(formatMoney(null)).toBe("");
      expect(formatMoney(undefined)).toBe("");
    });

    it("returns empty string for null options", () => {
      expect(formatMoney(100, null)).toBe("");
    });

    it("defaults locale to i18n.resolvedLanguage", () => {
      const result = formatMoney(100, { currency: "XAF" });
      expect(result).toBeTruthy();
    });

    it("respects explicit locale for fr-CM grouping", () => {
      const result = formatMoney(1234567, {
        currency: "XAF",
        locale: "fr-CM",
      });
      expect(result).toMatch(/1\s*234\s*567/);
    });

    it("respects explicit locale for en grouping", () => {
      const result = formatMoney(1234567, {
        currency: "XAF",
        locale: "en-US",
      });
      expect(result).toMatch(/1,234,567/);
    });

    it("handles other currencies with Intl.NumberFormat", () => {
      const result = formatMoney(100, {
        currency: "EUR",
        locale: "fr-CM",
      });
      expect(result).toBeTruthy();
      expect(result).toContain("€");
    });
  });

  describe("formatDate", () => {
    it("formats valid ISO date", () => {
      const result = formatDate("2026-07-26");
      expect(result).toBeTruthy();
      expect(result).not.toBe("");
    });

    it("returns empty string for null", () => {
      expect(formatDate(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(formatDate(undefined)).toBe("");
    });

    it("returns empty string for invalid date", () => {
      expect(formatDate("invalid")).toBe("");
    });

    it("uses dateStyle: short", () => {
      const result = formatDate("2026-07-26");
      expect(result.length).toBeLessThan(20);
    });

    it("respects explicit locale", () => {
      const frResult = formatDate("2026-07-26", "fr-CM");
      const enResult = formatDate("2026-07-26", "en-US");
      expect(frResult).toBeTruthy();
      expect(enResult).toBeTruthy();
    });

    it("defaults to i18n.resolvedLanguage", () => {
      const result = formatDate("2026-07-26");
      expect(result).toBeTruthy();
    });
  });

  describe("formatDateTime", () => {
    it("formats valid ISO datetime", () => {
      const result = formatDateTime("2026-07-26T14:30:00Z");
      expect(result).toBeTruthy();
      expect(result).not.toBe("");
    });

    it("returns empty string for null", () => {
      expect(formatDateTime(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(formatDateTime(undefined)).toBe("");
    });

    it("returns empty string for invalid datetime", () => {
      expect(formatDateTime("invalid")).toBe("");
    });

    it("includes both date and time", () => {
      const result = formatDateTime("2026-07-26T14:30:00Z");
      expect(result.length).toBeGreaterThan(
        formatDate("2026-07-26")?.length ?? 0
      );
    });

    it("respects explicit locale", () => {
      const frResult = formatDateTime("2026-07-26T14:30:00Z", "fr-CM");
      const enResult = formatDateTime("2026-07-26T14:30:00Z", "en-US");
      expect(frResult).toBeTruthy();
      expect(enResult).toBeTruthy();
    });
  });

  describe("formatDayLong", () => {
    it("spells the month out for a day heading", () => {
      expect(formatDayLong("2026-07-31T12:00:00Z", "fr-CM")).toBe("31 juillet 2026");
      expect(formatDayLong("2026-07-31T12:00:00Z", "en-US")).toBe("July 31, 2026");
    });

    it("accepts a Date as readily as an ISO string", () => {
      const iso = "2026-07-31T12:00:00Z";
      expect(formatDayLong(new Date(iso), "en-US")).toBe(formatDayLong(iso, "en-US"));
    });

    it("returns empty string for null, undefined or nonsense", () => {
      expect(formatDayLong(null)).toBe("");
      expect(formatDayLong(undefined)).toBe("");
      expect(formatDayLong("invalid")).toBe("");
    });

    it("says more than the short form", () => {
      expect(formatDayLong("2026-07-31T12:00:00Z", "fr-CM").length).toBeGreaterThan(
        formatDate("2026-07-31T12:00:00Z", "fr-CM").length
      );
    });
  });

  describe("localDayKey", () => {
    it("keys a timestamp by the viewer's own calendar day", () => {
      const local = new Date(2026, 6, 31, 23, 30);
      expect(localDayKey(local)).toBe("2026-07-31");
      expect(localDayKey(local.toISOString())).toBe("2026-07-31");
    });

    it("pads month and day to two digits", () => {
      expect(localDayKey(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05");
    });

    it("gives two instants on the same local day the same key", () => {
      expect(localDayKey(new Date(2026, 6, 31, 0, 1))).toBe(
        localDayKey(new Date(2026, 6, 31, 23, 59))
      );
    });

    it("returns empty string for null, undefined or nonsense", () => {
      expect(localDayKey(null)).toBe("");
      expect(localDayKey(undefined)).toBe("");
      expect(localDayKey("invalid")).toBe("");
    });
  });

  describe("localizedLabel", () => {
    it("returns labelEn when language is en", () => {
      const result = localizedLabel(
        { labelFr: "Français", labelEn: "English" },
        "en"
      );
      expect(result).toBe("English");
    });

    it("returns labelFr when language is not en", () => {
      const result = localizedLabel(
        { labelFr: "Français", labelEn: "English" },
        "fr-CM"
      );
      expect(result).toBe("Français");
    });

    it("falls back to labelFr when labelEn is empty", () => {
      const result = localizedLabel(
        { labelFr: "Français", labelEn: "" },
        "en"
      );
      expect(result).toBe("Français");
    });

    it("falls back to labelFr when labelEn is null", () => {
      const result = localizedLabel(
        { labelFr: "Français", labelEn: null },
        "en"
      );
      expect(result).toBe("Français");
    });

    it("returns labelFr when language is fr-CM", () => {
      const result = localizedLabel(
        { labelFr: "Français", labelEn: "English" },
        "fr-CM"
      );
      expect(result).toBe("Français");
    });

    it("returns empty string for null labels", () => {
      expect(localizedLabel(null)).toBe("");
    });

    it("returns empty string for undefined labels", () => {
      expect(localizedLabel(undefined)).toBe("");
    });

    it("returns empty string when both labels are empty", () => {
      const result = localizedLabel({ labelFr: "", labelEn: "" });
      expect(result).toBe("");
    });

    it("uses i18n.resolvedLanguage when language not specified", () => {
      const result = localizedLabel({ labelFr: "FR", labelEn: "EN" });
      expect(result).toBeTruthy();
    });
  });
});
