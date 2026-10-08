import { describe, expect, it } from "vitest";
import { formatMoney, moneyAmountParts, parseWholeAmount } from "./format.js";

const plain = (value: string) => value.replace(/[  ]/g, " ");

describe("whole amounts, as an input shows and reads them", () => {
  it("lays the figure out exactly as formatMoney does", () => {
    for (const locale of ["en", "fr-CM"]) {
      const { amount, symbol, symbolFirst } = moneyAmountParts(45_000_000, { locale });
      const shown = symbolFirst ? `${symbol} ${amount}` : `${amount} ${symbol}`;
      expect(plain(shown)).toBe(plain(formatMoney(45_000_000, { locale })));
    }
    expect(moneyAmountParts(45_000_000, { locale: "en" })).toEqual({
      amount: "45,000,000",
      symbol: "FCFA",
      symbolFirst: true,
    });
    expect(moneyAmountParts(null, { locale: "fr-CM" }).amount).toBe("");
  });

  it("reads each language's grouping, and the dots people write in French", () => {
    expect(parseWholeAmount("45,000,000", "en")).toEqual({ kind: "amount", minor: 45_000_000 });
    expect(parseWholeAmount("45 000 000", "fr-CM")).toEqual({ kind: "amount", minor: 45_000_000 });
    expect(parseWholeAmount("45 000 000", "fr-CM")).toEqual({ kind: "amount", minor: 45_000_000 });
    expect(parseWholeAmount("45.000.000", "fr-CM")).toEqual({ kind: "amount", minor: 45_000_000 });
    expect(parseWholeAmount("  ", "en")).toEqual({ kind: "empty" });
  });

  it("refuses a decimal part rather than rounding it away", () => {
    expect(parseWholeAmount("45,000.50", "en").kind).toBe("invalid");
    expect(parseWholeAmount("45 000,5", "fr-CM").kind).toBe("invalid");
    expect(parseWholeAmount("12abc", "en").kind).toBe("invalid");
    expect(parseWholeAmount("9".repeat(20), "en").kind).toBe("invalid");
  });

  it("refuses a group separator out of place instead of gluing the digits", () => {
    expect(parseWholeAmount("4,5", "en").kind).toBe("invalid");
    expect(parseWholeAmount("45,00,000", "en").kind).toBe("invalid");
    expect(parseWholeAmount("86,000", "en")).toEqual({ kind: "amount", minor: 86_000 });
  });
});
