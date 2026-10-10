import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  formatPercent,
  formatMoney,
  formatDate,
  formatDateTime,
  formatDayLong,
  localDayKey,
  localizedLabel,
  notRecorded,
  profitOrLoss,
} from "./format.js";
import { i18n } from "../i18n/index.js";

describe("format", () => {
  describe("formatMoney", () => {
    const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");
    const en = (minor: number, sign?: Parameters<typeof formatMoney>[1]) =>
      plain(formatMoney(minor, { locale: "en", ...sign }));
    const fr = (minor: number, sign?: Parameters<typeof formatMoney>[1]) =>
      plain(formatMoney(minor, { locale: "fr-CM", ...sign }));

    it("formats XAF with exponent 0 (no division)", () => {
      expect(fr(150_000)).toBe("150 000 FCFA");
      expect(en(150_000)).toBe("FCFA 150,000");
    });

    describe("the sign rule", () => {
      it("signs a ledger line from its direction: revenue +, expense −", () => {
        const expense = { sign: { context: "ledger", direction: "EXPENSE" } } as const;
        const revenue = { sign: { context: "ledger", direction: "REVENUE" } } as const;
        expect(en(86_000, expense)).toBe("−FCFA 86,000");
        expect(fr(86_000, expense)).toBe("−86 000 FCFA");
        expect(en(86_000, revenue)).toBe("+FCFA 86,000");
        expect(fr(86_000, revenue)).toBe("+86 000 FCFA");
      });

      it("flips a reversal, whose stored amount is negative", () => {
        expect(en(-86_000, { sign: { context: "ledger", direction: "EXPENSE" } })).toBe("+FCFA 86,000");
        expect(en(-86_000, { sign: { context: "ledger", direction: "REVENUE" } })).toBe("−FCFA 86,000");
      });

      it("signs a net by its own value, and leaves zero bare", () => {
        expect(en(-171_000, { sign: { context: "net" } })).toBe("−FCFA 171,000");
        expect(fr(2_850_000, { sign: { context: "net" } })).toBe("+2 850 000 FCFA");
        expect(en(0, { sign: { context: "net" } })).toBe("FCFA 0");
      });

      it("never signs a record's own amount, a reversal's included", () => {
        expect(en(86_000, { sign: { context: "record" } })).toBe("FCFA 86,000");
        expect(fr(-86_000, { sign: { context: "record" } })).toBe("86 000 FCFA");
      });

      it("signs only a negative amount when no sign is asked for", () => {
        expect(en(86_000)).toBe("FCFA 86,000");
        expect(en(-86_000)).toBe("−FCFA 86,000");
        expect(fr(-86_000)).toBe("−86 000 FCFA");
        expect(en(0)).toBe("FCFA 0");
      });
    });

    describe("profitOrLoss", () => {
      const plainText = (minor: number, locale: string) => {
        const result = profitOrLoss(minor, { locale });
        return { ...result, amount: plain(result.amount), text: plain(result.text) };
      };

      it("says Loss for a balance below zero, never a negative profit", () => {
        expect(plainText(-86_000, "en")).toEqual({
          kind: "loss",
          label: "Loss",
          amount: "FCFA 86,000",
          text: "Loss FCFA 86,000",
        });
        expect(plainText(-86_000, "fr-CM")).toEqual({
          kind: "loss",
          label: "Perte",
          amount: "86 000 FCFA",
          text: "Perte 86 000 FCFA",
        });
      });

      it("says Profit at zero and above, without a sign", () => {
        expect(plainText(2_850_000, "fr-CM").text).toBe("Bénéfice 2 850 000 FCFA");
        expect(plainText(2_850_000, "en").text).toBe("Profit FCFA 2,850,000");
        expect(plainText(0, "en")).toMatchObject({ kind: "profit", label: "Profit", amount: "FCFA 0" });
      });
    });

    it("normalizes U+202F to regular space", () => {
      const result = formatMoney(150000, { currency: "XAF", locale: "fr-CM" });
      expect(result).not.toContain("\u202f");
      expect(result).toMatch(/\s/);
    });

    it("returns empty string for null/undefined", () => {
      expect(formatMoney(null)).toBe("");
      expect(formatMoney(undefined)).toBe("");
    });

    it("returns empty string for null options", () => {
      expect(formatMoney(100, null)).toBe("");
    });

    it("defaults locale to the active language", async () => {
      await i18n.changeLanguage("en");
      expect(plain(formatMoney(1_234_567))).toBe("FCFA 1,234,567");
      await i18n.changeLanguage("fr-CM");
      expect(plain(formatMoney(1_234_567))).toBe("1 234 567 FCFA");
    });

    it("handles other currencies", () => {
      expect(formatMoney(100, { currency: "EUR", locale: "fr-CM" })).toContain("€");
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
  });
});
