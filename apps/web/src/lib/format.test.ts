import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  currencyUnit,
  formatCompact,
  formatCount,
  formatPercent,
  formatMoney,
  formatDate,
  formatDateFull,
  formatDateInput,
  formatDateRange,
  formatDateTime,
  formatDayLong,
  formatDayMonth,
  formatMonth,
  formatTime,
  formatWeekday,
  localDayKey,
  localizedLabel,
  notRecorded,
  profitOrLoss,
} from "./format.js";
import { i18n } from "../i18n/index.js";

describe("format", () => {
  describe("formatMoney", () => {
    // Shown here with "_" for the non-breaking space, so a test reads like the screen.
    const shown = (value: string) => value.replace(/ /g, "_");
    const en = (minor: number, sign?: Parameters<typeof formatMoney>[1]) =>
      shown(formatMoney(minor, { locale: "en", ...sign }));
    const fr = (minor: number, sign?: Parameters<typeof formatMoney>[1]) =>
      shown(formatMoney(minor, { locale: "fr-CM", ...sign }));

    it("writes 450 000 FCFA in both languages: XAF has exponent 0, never divided (#712)", () => {
      expect(fr(450_000)).toBe("450_000_FCFA");
      expect(en(450_000)).toBe("450_000_FCFA");
      expect(en(150)).toBe("150_FCFA");
      expect(en(1_234_567_890)).toBe("1_234_567_890_FCFA");
    });

    it("joins digits and unit with non-breaking spaces only, so an amount never wraps (#695)", () => {
      const result = formatMoney(2_850_000, { locale: "en" });
      expect(result).toBe("2 850 000 FCFA");
      expect(result).not.toMatch(/[  ,]/);
    });

    describe("the sign rule", () => {
      it("signs a ledger line from its direction: revenue +, expense −", () => {
        const expense = { sign: { context: "ledger", direction: "EXPENSE" } } as const;
        const revenue = { sign: { context: "ledger", direction: "REVENUE" } } as const;
        expect(en(86_000, expense)).toBe("−86_000_FCFA");
        expect(fr(86_000, expense)).toBe("−86_000_FCFA");
        expect(en(86_000, revenue)).toBe("+86_000_FCFA");
        expect(fr(86_000, revenue)).toBe("+86_000_FCFA");
      });

      it("flips a reversal, whose stored amount is negative", () => {
        expect(en(-86_000, { sign: { context: "ledger", direction: "EXPENSE" } })).toBe("+86_000_FCFA");
        expect(en(-86_000, { sign: { context: "ledger", direction: "REVENUE" } })).toBe("−86_000_FCFA");
      });

      it("signs a net by its own value, and leaves zero bare", () => {
        expect(en(-171_000, { sign: { context: "net" } })).toBe("−171_000_FCFA");
        expect(fr(2_850_000, { sign: { context: "net" } })).toBe("+2_850_000_FCFA");
        expect(en(0, { sign: { context: "net" } })).toBe("0_FCFA");
      });

      it("never signs a record's own amount, a reversal's included", () => {
        expect(en(86_000, { sign: { context: "record" } })).toBe("86_000_FCFA");
        expect(fr(-86_000, { sign: { context: "record" } })).toBe("86_000_FCFA");
      });

      it("signs only a negative amount when no sign is asked for, with a true minus", () => {
        expect(en(86_000)).toBe("86_000_FCFA");
        expect(en(-86_000)).toBe("−86_000_FCFA");
        expect(fr(-86_000)).toBe("−86_000_FCFA");
        expect(en(0)).toBe("0_FCFA");
        expect(en(-86_000)).not.toContain("-");
      });
    });

    describe("profitOrLoss", () => {
      const shownText = (minor: number, locale: string) => {
        const result = profitOrLoss(minor, { locale });
        return { ...result, amount: shown(result.amount), text: shown(result.text) };
      };

      it("says Loss for a balance below zero, never a negative profit", () => {
        expect(shownText(-86_000, "en")).toEqual({
          kind: "loss",
          label: "Loss",
          amount: "86_000_FCFA",
          text: "Loss 86_000_FCFA",
        });
        expect(shownText(-86_000, "fr-CM")).toEqual({
          kind: "loss",
          label: "Perte",
          amount: "86_000_FCFA",
          text: "Perte 86_000_FCFA",
        });
      });

      it("says Profit at zero and above, without a sign", () => {
        expect(shownText(2_850_000, "fr-CM").text).toBe("Bénéfice 2_850_000_FCFA");
        expect(shownText(2_850_000, "en").text).toBe("Profit 2_850_000_FCFA");
        expect(shownText(0, "en")).toMatchObject({ kind: "profit", label: "Profit", amount: "0_FCFA" });
      });
    });

    it("returns empty string for null/undefined", () => {
      expect(formatMoney(null)).toBe("");
      expect(formatMoney(undefined)).toBe("");
    });

    it("returns empty string for null options", () => {
      expect(formatMoney(100, null)).toBe("");
    });

    it("reads the same whatever the active language", async () => {
      await i18n.changeLanguage("en");
      expect(shown(formatMoney(1_234_567))).toBe("1_234_567_FCFA");
      await i18n.changeLanguage("fr-CM");
      expect(shown(formatMoney(1_234_567))).toBe("1_234_567_FCFA");
    });

    it("writes another currency's own symbol after the amount", () => {
      expect(shown(formatMoney(100, { currency: "EUR", locale: "fr-CM" }))).toBe("100_€");
      expect(currencyUnit("XAF")).toBe("FCFA");
    });
  });

  describe("formatDate", () => {
    it("writes 29 July 2026 / 29 juillet 2026, day first in English too (#712)", () => {
      expect(formatDate("2026-07-29", "en")).toBe("29 July 2026");
      expect(formatDate("2026-07-29", "en-US")).toBe("29 July 2026");
      expect(formatDate("2026-07-29", "fr-CM")).toBe("29 juillet 2026");
    });

    it("allows the short month for a dense table, never a two-digit year", () => {
      expect(formatDate("2026-07-29", "en", "short")).toBe("29 Jul 2026");
      expect(formatDate("2026-07-29", "fr-CM", "short")).toBe("29 juil. 2026");
    });

    it("returns empty string for null, undefined or nonsense", () => {
      expect(formatDate(null)).toBe("");
      expect(formatDate(undefined)).toBe("");
      expect(formatDate("invalid")).toBe("");
    });

    it("follows the active language", async () => {
      await i18n.changeLanguage("en");
      expect(formatDate("2026-07-29")).toBe("29 July 2026");
      await i18n.changeLanguage("fr-CM");
      expect(formatDate("2026-07-29")).toBe("29 juillet 2026");
    });
  });

  describe("formatDateTime and formatTime", () => {
    beforeEach(() => {
      vi.stubEnv("TZ", "UTC");
    });

    it("writes 29 July 2026, 07:00 on a 24-hour clock in both languages", () => {
      expect(formatDateTime("2026-07-29T07:00:00Z", "en")).toBe("29 July 2026, 07:00");
      expect(formatDateTime("2026-07-29T19:05:00Z", "fr-CM")).toBe("29 juillet 2026, 19:05");
      expect(formatDateTime("2026-07-29T19:05:00Z", "en", "short")).toBe("29 Jul 2026, 19:05");
      expect(formatTime("2026-07-29T19:05:00Z", "en")).toBe("19:05");
    });

    it("returns empty string for null, undefined or nonsense", () => {
      expect(formatDateTime(null)).toBe("");
      expect(formatDateTime(undefined)).toBe("");
      expect(formatDateTime("invalid")).toBe("");
      expect(formatTime("invalid")).toBe("");
    });
  });

  describe("days, ranges and months", () => {
    it("writes a day without its year day first: 5 Oct, Monday 5 October", () => {
      expect(formatDayMonth("2026-10-05", "en", { month: "short" })).toBe("5 Oct");
      expect(formatDayMonth("2026-10-05", "en", { weekday: true })).toBe("Monday 5 October");
      expect(formatDayMonth("2026-10-05", "fr-CM", { weekday: true })).toBe("lundi 5 octobre");
    });

    it("writes a span of days or of whole months", () => {
      expect(formatDateRange("2026-10-01", "2026-10-10", "en", { unit: "days" })).toBe("1–10 October");
      expect(formatDateRange("2026-07-01", "2026-09-30", "en", { unit: "months" })).toBe("July\u2009–\u2009September 2026");
    });

    it("puts thin spaces round the dash only between two months or years", () => {
      const days = { unit: "days" } as const;
      expect(formatDateRange("2026-10-01", "2026-10-10", "fr-CM", days)).toBe("1–10 octobre");
      expect(formatDateRange("2026-09-01", "2026-09-09", "en", { unit: "days", month: "short" })).toBe("1–9 Sept");
      expect(formatDateRange("2026-10-04", "2026-10-04", "en", days)).toBe("4 October");
      expect(formatDateRange("2026-09-28", "2026-10-04", "en", { unit: "days", month: "short" })).toBe("28 Sept\u2009–\u20094 Oct");
      expect(formatDateRange("2026-09-28", "2026-10-04", "fr-CM", { unit: "days", month: "short" })).toBe(
        "28 sept.\u2009–\u20094 oct.",
      );
      expect(formatDateRange("2026-12-28", "2027-01-04", "en", days)).toBe("28 December 2026\u2009–\u20094 January 2027");
      expect(formatDateRange("2026-07-01", "2026-09-30", "fr-CM", { unit: "months" })).toBe("juillet\u2009–\u2009septembre 2026");
      expect(formatDateRange("2026-09-01", "2026-09-30", "en", { unit: "months" })).toBe("September 2026");
      expect(formatDateRange("2025-11-01", "2026-02-28", "en", { unit: "months" })).toBe(
        "November 2025\u2009–\u2009February 2026",
      );
    });

    it("reads the same on every platform: no date or figure comes from the ICU data behind Intl", () => {
      // Node, browsers and phones ship different ICU versions; ICU 78 rewrote "1–10 October" as "1 – 10 October".
      const dateFormat = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
        throw new Error("Intl.DateTimeFormat used");
      });
      const numberFormat = vi.spyOn(Intl, "NumberFormat").mockImplementation(() => {
        throw new Error("Intl.NumberFormat used");
      });
      try {
        expect(formatDate("2026-07-29", "en", "short")).toBe("29 Jul 2026");
        expect(formatDateTime("2026-07-29T07:00:00Z", "fr-CM")).toMatch(/^29 juillet 2026, \d\d:00$/);
        expect(formatDateFull("2026-07-29", "fr-CM")).toBe("mercredi 29 juillet 2026");
        expect(formatDateRange("2026-10-01", "2026-10-10", "en")).toBe("1–10 October");
        expect(formatMonth("2026-09", "fr-CM", { month: "short" })).toBe("sept. 2026");
        expect(formatWeekday(new Date(2026, 6, 29), "en", "narrow")).toBe("W");
        expect(formatMoney(450_000, { locale: "fr-CM" })).toBe("450\u00a0000\u00a0FCFA");
        expect(formatPercent(11, "fr-CM")).toBe("11 %");
        expect(formatCount(4_800, "en")).toBe("4,800");
        expect(formatCompact(450_000, "en")).toBe("450K");
      } finally {
        dateFormat.mockRestore();
        numberFormat.mockRestore();
      }
    });

    it("writes a month with or without its year", () => {
      expect(formatMonth("2026-09", "en")).toBe("September 2026");
      expect(formatMonth("2026-09", "fr-CM")).toBe("septembre 2026");
      expect(formatMonth("2026-09-15", "en", { month: "short", year: false })).toBe("Sept");
    });

    it("writes a chart axis figure short, with a true minus", () => {
      expect(formatCompact(-85_000, "en")).toBe("−85K");
      expect(formatCompact(2_300_000, "en")).toBe("2.3M");
      expect(formatCompact(450_000, "en")).toBe("450K");
      expect(formatCompact(3_000_000_000, "en")).toBe("3B");
      expect(formatCompact(999_950, "en")).toBe("1M");
      expect(formatCompact(2_500_000, "fr-CM")).toBe("2,5 M");
      expect(formatCompact(450_000, "fr-CM")).toBe("450 k");
      expect(formatCompact(3_000_000_000, "fr-CM")).toBe("3 Md");
      expect(formatCompact(0, "en")).toBe("0");
      expect(formatCompact(12.5, "en")).toBe("12.5");
    });

    it("gives a date input dd/mm/yyyy in both languages", () => {
      expect(formatDateInput("2026-07-29")).toBe("29/07/2026");
      expect(formatDateInput("2026-07-29T14:30")).toBe("29/07/2026");
      expect(formatDateInput("")).toBe("");
    });

    it("reads a calendar day out in full for a screen reader", () => {
      expect(formatDateFull("2026-07-29", "en")).toBe("Wednesday, 29 July 2026");
      expect(formatWeekday(new Date(2026, 6, 29), "fr-CM", "short")).toBe("mer.");
    });
  });

  describe("formatDayLong", () => {
    it("spells the month out for a day heading, day first", () => {
      expect(formatDayLong("2026-07-31T12:00:00Z", "fr-CM")).toBe("31 juillet 2026");
      expect(formatDayLong("2026-07-31T12:00:00Z", "en-US")).toBe("31 July 2026");
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

  describe("notRecorded", () => {
    it("says a missing value in words in fr and en, never a dash", () => {
      expect(notRecorded("fr-CM")).toBe("Non renseigné");
      expect(notRecorded("en")).toBe("Not recorded");
    });

    it("follows the app language when no locale is given", async () => {
      await i18n.changeLanguage("en");
      expect(notRecorded()).toBe("Not recorded");
      await i18n.changeLanguage("fr-CM");
      expect(notRecorded()).toBe("Non renseigné");
    });
  });
});

describe("formatPercent", () => {
  it("writes a whole percent the reader's way, with plain spaces", () => {
    expect(formatPercent(11, "en")).toBe("11%");
    expect(formatPercent(11, "fr-CM")).toBe("11 %");
    expect(formatPercent(7.4, "en")).toBe("7%");
    expect(formatPercent(-12.5, "en")).toBe("-13%");
    expect(formatPercent(1_250, "fr-CM")).toBe("1 250 %");
  });
});

describe("formatCount", () => {
  it("groups a whole count the reader's way, with plain spaces", () => {
    expect(formatCount(4_800, "en")).toBe("4,800");
    expect(formatCount(4_800, "fr-CM")).toBe("4 800");
    expect(formatCount(1_234_567.6, "en")).toBe("1,234,568");
    expect(formatCount(-4_800, "fr-CM")).toBe("-4 800");
    expect(formatCount(950, "fr-CM")).toBe("950");
  });
});
