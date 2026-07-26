import { describe, expect, it } from "vitest";
import { assertMoneyMinor, formatXAF } from "./money.js";

describe("XAF money", () => {
  it("accepts integers", () => {
    expect(assertMoneyMinor(7_400_000)).toBe(7_400_000);
  });

  it("rejects fractional amounts", () => {
    expect(() => assertMoneyMinor(100.5)).toThrow(RangeError);
  });

  it("formats with zero fraction digits", () => {
    expect(formatXAF(408_000, "fr-CM")).not.toMatch(/[.,]00/);
  });

  describe("formatXAF backward compatibility", () => {
    it("accepts old call shape: formatXAF(minor, locale)", () => {
      const result = formatXAF(150_000, "fr-CM");
      expect(result).toContain("FCFA");
    });

    it("formats with default locale when not specified", () => {
      const result = formatXAF(150_000);
      expect(result).toContain("FCFA");
    });
  });

  describe("formatXAF options bag", () => {
    it("accepts options object with locale", () => {
      const result = formatXAF(150_000, { locale: "en-US" });
      expect(result).toContain("FCFA");
    });

    it("respects signDisplay: always", () => {
      const positive = formatXAF(100, { signDisplay: "always" });
      const negative = formatXAF(-100, { signDisplay: "always" });
      expect(positive).toMatch(/^[+]/);
      expect(negative).toMatch(/^[-]/);
    });

    it("respects signDisplay: exceptZero", () => {
      const positive = formatXAF(100, { signDisplay: "exceptZero" });
      const zero = formatXAF(0, { signDisplay: "exceptZero" });
      expect(positive).toMatch(/^[+]/);
      expect(zero).not.toMatch(/^[+-]/);
    });

    it("respects signDisplay: never (no sign)", () => {
      const result = formatXAF(-100, { signDisplay: "never" });
      expect(result).not.toMatch(/^[-]/);
    });

    it("exponent 0: 150000 minor units → 150 000 FCFA", () => {
      const result = formatXAF(150_000, { locale: "fr-CM" });
      expect(result).toMatch(/150\s*000.*FCFA/);
      expect(result).not.toMatch(/1500\.00|1500,00/);
    });

    it("combines locale and signDisplay options", () => {
      const result = formatXAF(150_000, {
        locale: "fr-CM",
        signDisplay: "always",
      });
      expect(result).toContain("FCFA");
      expect(result).toMatch(/^[+]/);
    });
  });
});
